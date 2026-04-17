const fs = require('fs');
const path = require('path');
const { loadEnv } = require('./loadEnv');
const { supabase } = require('./supabase');
const { analyzeTrend }  = require('./analyzeTrend');
const { scoreImpact }   = require('./scoreImpact');
const { scoreRepresent } = require('./scoreRepresent');
const { combineScore }    = require('./combineScore');
const { calcSimilarity }  = require('./similarity');
const { calcTimeDecay }   = require('./timeDecay');
const { loadHistory, saveHistory } = require('./historyStore');
const { generateEventId }          = require('./eventId');
const { extractKeywords }          = require('./services/keywordExtractor');

loadEnv();

console.log('🔥 select-news 모듈 로드됨:', new Date().toISOString());

// 헤더 값에 비ASCII 문자가 포함되면 fetch ByteString 오류 발생 → 제거
const NAVER_ID = (process.env.NAVER_CLIENT_ID || '').replace(/[^\x20-\x7E]/g, '');
const NAVER_SECRET = (process.env.NAVER_CLIENT_SECRET || '').replace(/[^\x20-\x7E]/g, '');
const OPENAI_KEY = (process.env.OPENAI_API_KEY || '').replace(/['"]/g, '').replace(/[^\x20-\x7E]/g, '');

console.log(`[키 확인] NAVER_ID: "${NAVER_ID.slice(0, 5)}..." (길이: ${NAVER_ID.length})`);
console.log(`[키 확인] NAVER_SECRET: "${NAVER_SECRET.slice(0, 5)}..." (길이: ${NAVER_SECRET.length})`);

const SEARCH_QUERIES = ['속보', '주요뉴스', '경제이슈', '사회이슈', '화제'];

async function fetchNaverNews(query) {
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=10&sort=date`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': NAVER_ID,
      'X-Naver-Client-Secret': NAVER_SECRET,
    },
  });
  if (!res.ok) throw new Error(`네이버 API 오류: ${res.status}`);
  const data = await res.json();
  return data.items || [];
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#0*39;/g, "'");
}

function deduplicateByTitle(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.title.slice(0, 20);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchFullTitle(url, fallback) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(timer);
    const html = await res.text();
    const match = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (!match) return fallback;
    // 언론사명 접미사 제거 (예: " | 연합뉴스", " - MBC뉴스")
    return stripHtml(match[1].replace(/\s*[\||\-–—]\s*.{1,20}$/, '').trim()) || fallback;
  } catch {
    return fallback;
  }
}

async function fetchArticleContent(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();

    // og:description 시도
    const ogMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
    if (ogMatch) return ogMatch[1].trim().slice(0, 1000);

    // <p> 태그 본문 추출
    const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map(m => stripHtml(m[1]).trim())
      .filter(t => t.length > 30)
      .join(' ');
    if (paragraphs.length > 0) return paragraphs.slice(0, 1000);

    return null;
  } catch {
    return null;
  }
}

async function generateReactions(title, content) {
  const prompt = `다음 뉴스에 대해 두 캐릭터의 반응을 생성해줘.

뉴스 제목: ${title}
뉴스 내용: ${(content || '').slice(0, 500)}

【준혁 (분석형 오빠)】
- 이 뉴스가 왜 중요한지 포함해서 한 줄로 핵심 정리
- 감정 표현 없이 객관적으로

【하나 (공감형 언니)】
- 이 뉴스를 본 유저에게 공감형 말투로 자연스럽게 질문
- 마지막에 선택지 포함: 좋음 / 모르겠음 / 걱정됨

아래 JSON 형식으로만 응답해:
{
  "junhyuk": "준혁의 분석 한 줄",
  "hana": "하나의 공감 질문 (선택지 포함)"
}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error('OpenAI 오류: ' + data.error.message);
  return JSON.parse(data.choices[0].message.content);
}

// ─── 메타데이터 추론 헬퍼 ───────────────────────────────────────────────────

// ─── 추모일 정의 ────────────────────────────────────────────────────────────
const MEMORIAL_DAYS = [
  { mmdd: '04-03', name: '제주 4·3',  keywords: ['4·3', '4.3', '제주4·3', '제주 4·3', '제주4.3', '사월삼일', '추모', '희생자', '분향', '기억'] },
  { mmdd: '04-16', name: '세월호',    keywords: ['세월호', '4·16', '4.16', '세월호 참사', '세월호참사', '추모', '희생자', '유가족', '분향', '기억'] },
  { mmdd: '05-18', name: '5·18',      keywords: ['5·18', '5.18', '광주민주화', '광주항쟁', '오월항쟁', '추모', '희생자', '기념', '묵념'] },
  { mmdd: '10-29', name: '이태원',    keywords: ['이태원', '10·29', '10.29', '이태원 참사', '이태원참사', '추모', '희생자', '유가족', '분향'] },
];

// 추모 중심성 점수 계산용 고정 키워드
const MEMORIAL_TITLE_WORDS   = ['추모', '기념', '기억', '분향', '헌화'];
const MEMORIAL_CONTENT_WORDS = ['희생자', '유가족', '추모식', '기억식', '묵념'];

function getTodayMemorial() {
  const mmdd = new Date().toISOString().slice(5, 10); // MM-DD
  return MEMORIAL_DAYS.find(m => m.mmdd === mmdd) || null;
}

/**
 * 추모 중심성 점수 기반으로 가장 적합한 기사 1개를 선택한다
 * @param {object} memorial  - { name, keywords, ... }
 * @param {Array}  candidates - withContent 필터링 결과
 * @returns {object} best article
 */
function pickMemorialNews(memorial, candidates) {
  const scored = candidates.map(item => {
    const title   = item.title   || '';
    const content = item.content || '';
    let score = 0;

    // [A] 제목에 추모 문맥 단어 포함 → +5
    if (MEMORIAL_TITLE_WORDS.some(w => title.includes(w))) score += 5;

    // [B] 제목에 사건명 직접 포함 → +3
    if (title.includes(memorial.name)) score += 3;

    // [C] 본문에 추모 문맥 단어 포함 → +2
    if (MEMORIAL_CONTENT_WORDS.some(w => content.includes(w))) score += 2;

    // [D] eventId에 '추모' 포함 → +5
    const eid = generateEventId(item, memorial.name);
    if (eid.includes('추모') || eid.includes('memorial')) score += 5;

    return { item, score };
  });

  // 점수 내림차순 → 동점 시 제목에 '추모' 포함 기사 우선
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aHas = a.item.title.includes('추모') ? 1 : 0;
    const bHas = b.item.title.includes('추모') ? 1 : 0;
    return bHas - aHas;
  });

  console.log('  [추모 중심성 점수 상위 3건]');
  scored.slice(0, 3).forEach(({ item, score }, i) => {
    console.log(`    ${i + 1}위 [${score}점] ${item.title.slice(0, 50)}`);
  });

  return scored[0].item;
}

// ─── 잡탕 기사 필터 ─────────────────────────────────────────────────────────

/**
 * 여러 개의 서로 다른 뉴스가 하나의 content에 섞인 "비정상 기사"를 감지한다.
 * 아래 4가지 조건 중 하나라도 명확히 해당하면 { filtered: true, reason } 반환.
 */
function isMixedContent(item) {
  const title   = item.title   || '';
  const content = item.content || '';

  // [조건 B-1] 줄임표(…) 3회 이상 — 여러 기사를 "…"로 이어붙인 패턴
  const ellipsisCount = (content.match(/…/g) || []).length;
  if (ellipsisCount >= 3) {
    return { filtered: true, reason: `B-줄임표×${ellipsisCount}` };
  }

  // [조건 B-2] 제목형 짧은 문장(< 35자)이 5개 이상이고 전체 문장의 60% 이상
  const sentences = content
    .split(/[.!?。]\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 5);
  if (sentences.length >= 5) {
    const shortCount = sentences.filter(s => s.length < 35).length;
    if (shortCount >= 5 && shortCount / sentences.length >= 0.6) {
      return { filtered: true, reason: `B-제목형문장×${shortCount}` };
    }
  }

  // [조건 A] keywordExtractor 결과 기준 — 4개 이상 서로 다른 카테고리에 걸쳐 있음
  const keywords = extractKeywords(item);
  if (keywords.length >= 6) {
    const hitCategories = new Set();
    for (const kw of keywords) {
      for (const { name, keywords: catKws } of CATEGORY_RULES) {
        if (catKws.some(ck => kw.includes(ck) || ck.includes(kw))) {
          hitCategories.add(name);
        }
      }
    }
    if (hitCategories.size >= 4) {
      return { filtered: true, reason: `A-카테고리분산×${hitCategories.size}(${[...hitCategories].join(',')})` };
    }
  }

  // [조건 C] 앞 2문장 vs 나머지 문장의 카테고리가 완전히 다름
  if (sentences.length >= 5) {
    const getCats = text => {
      const cats = new Set();
      for (const { name, keywords: catKws } of CATEGORY_RULES) {
        if (catKws.some(k => text.includes(k))) cats.add(name);
      }
      return cats;
    };
    const frontCats = getCats(sentences.slice(0, 2).join(' '));
    const backCats  = getCats(sentences.slice(2).join(' '));
    if (frontCats.size > 0 && backCats.size > 0) {
      const common = [...frontCats].filter(c => backCats.has(c));
      if (common.length === 0) {
        return { filtered: true, reason: `C-주제불일치(${[...frontCats].join(',')}↔${[...backCats].join(',')})` };
      }
    }
  }

  // [조건 D] 긴 본문(800자 이상)인데 추출 키워드 중 2회 이상 반복되는 것이 없음
  if (content.length > 800 && keywords.length >= 3) {
    const fullText   = title + ' ' + content;
    const anyRepeated = keywords.some(kw => {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (fullText.match(new RegExp(escaped, 'g')) || []).length >= 2;
    });
    if (!anyRepeated) {
      return { filtered: true, reason: `D-키워드반복없음(${content.length}자)` };
    }
  }

  return { filtered: false };
}

// 조건 A·C용 카테고리 규칙 (CATEGORY_MAP과 별개로 필터 전용)
const CATEGORY_RULES = [
  { name: 'IT',     keywords: ['AI', '인공지능', '반도체', '구글', '삼성전자', '메타', '오픈AI', '챗GPT', '소프트웨어'] },
  { name: '금융',   keywords: ['금리', '주가', '증시', '코스피', '달러', '환율', '채권', '은행'] },
  { name: '경제',   keywords: ['경제', '물가', '관세', '무역', '수출', 'GDP', '인플레', '성장률'] },
  { name: '부동산', keywords: ['부동산', '아파트', '주택', '전세', '집값', '분양', '임대'] },
  { name: '정치',   keywords: ['국회', '대통령', '여당', '야당', '선거', '탄핵', '의원'] },
  { name: '국제',   keywords: ['미국', '중국', '러시아', '유럽', '트럼프', '바이든', '시진핑', '북한'] },
  { name: '건강',   keywords: ['의료', '병원', '백신', '바이러스', '코로나', '암', '질병'] },
  { name: '문화',   keywords: ['영화', '음악', '드라마', 'BTS', 'K팝', '아이돌', '공연'] },
  { name: '스포츠', keywords: ['축구', '야구', '농구', '올림픽', '월드컵', '선수', '경기', '리그'] },
  { name: '사회',   keywords: ['사건', '사고', '범죄', '복지', '교육', '학교', '노동'] },
];

const CATEGORY_MAP = [
  { name: '추모',   keywords: ['세월호', '이태원', '5·18', '5.18', '4·3', '광주민주화', '광주항쟁'] },
  { name: 'IT',     keywords: ['AI', '인공지능', '반도체', '빅테크', '구글', '삼성전자', '메타', '오픈AI', '챗GPT', '소프트웨어', '스타트업'] },
  { name: '금융',   keywords: ['금리', '주가', '증시', '코스피', '코스닥', '달러', '환율', '채권', '은행', '금융'] },
  { name: '경제',   keywords: ['경제', '물가', '관세', '무역', '수출', '수입', 'GDP', '인플레', '성장률', '소비자'] },
  { name: '부동산', keywords: ['부동산', '아파트', '주택', '전세', '집값', '분양', '임대'] },
  { name: '정치',   keywords: ['국회', '대통령', '여당', '야당', '선거', '정당', '탄핵', '의원', '정치'] },
  { name: '국제',   keywords: ['미국', '중국', '러시아', '유럽', '이란', '트럼프', '바이든', '시진핑', '푸틴', '북한'] },
  { name: '건강',   keywords: ['의료', '건강', '병원', '백신', '바이러스', '코로나', '암', '질병'] },
  { name: '환경',   keywords: ['기후', '탄소', '환경', '에너지', '원전', '태양광'] },
  { name: '문화',   keywords: ['영화', '음악', '드라마', '문화', '예술', '공연'] },
  { name: '사회',   keywords: ['사건', '사고', '범죄', '복지', '교육', '학교', '노동'] },
];

const CATEGORY_EMOJI = {
  '추모': '🕯️', 'IT': '💻', '금융': '💰', '경제': '📈', '부동산': '🏠',
  '정치': '🏛️', '국제': '🌍', '건강': '🏥', '환경': '🌱',
  '문화': '🎭', '사회': '👥',
};

const DOMAIN_SOURCE = {
  'yna.co.kr': '연합뉴스', 'yonhapnewstv.co.kr': '연합뉴스TV',
  'kbs.co.kr': 'KBS', 'mbc.co.kr': 'MBC', 'sbs.co.kr': 'SBS',
  'jtbc.co.kr': 'JTBC', 'tvchosun.com': 'TV조선', 'mbn.co.kr': 'MBN',
  'chosun.com': '조선일보', 'joins.com': '중앙일보', 'donga.com': '동아일보',
  'hani.co.kr': '한겨레', 'khan.co.kr': '경향신문', 'ohmynews.com': '오마이뉴스',
  'newsis.com': '뉴시스', 'news1.kr': '뉴스1', 'ytn.co.kr': 'YTN',
  'edaily.co.kr': '이데일리', 'mt.co.kr': '머니투데이',
  'hankyung.com': '한국경제', 'mk.co.kr': '매일경제', 'sedaily.com': '서울경제',
  'dt.co.kr': '디지털타임스', 'etnews.com': '전자신문', 'zdnet.co.kr': 'ZDNet Korea',
  'nocutnews.co.kr': '노컷뉴스', 'pressian.com': '프레시안',
};

function inferTag(item) {
  const text = item.title + ' ' + (item.content || '');
  for (const { name, keywords } of CATEGORY_MAP) {
    if (keywords.some(k => text.includes(k))) return `오늘의 픽 · ${name}`;
  }
  return '오늘의 픽 · 사회';
}

function inferEmoji(tag) {
  const category = tag.replace('오늘의 픽 · ', '');
  return CATEGORY_EMOJI[category] || '📰';
}

function makeSummary(content) {
  if (!content) return ['내용을 불러오지 못했습니다.', '', ''];
  const sentences = content
    .split(/(?<=[다했요음죠죠임]\.)\s+|[。!?]\s+/)
    .map(s => s.trim().replace(/\s+/g, ' '))
    .filter(s => s.length >= 10);
  const result = sentences.slice(0, 3).map(s => s.slice(0, 25));
  while (result.length < 3) result.push('');
  return result;
}

function inferSource(link) {
  try {
    const hostname = new URL(link).hostname.replace(/^www\./, '');
    for (const [domain, name] of Object.entries(DOMAIN_SOURCE)) {
      if (hostname.includes(domain)) return name;
    }
    return hostname;
  } catch {
    return '알 수 없음';
  }
}

// ─── 뉴스 선정 (코드 기반) ───────────────────────────────────────────────────

function pickBestNews(newsList, analysisMap, history) {
  const today = new Date().toISOString().slice(0, 10);
  const nowMs = Date.now();

  console.log('    가중치: impact×0.5 + represent×0.3 + diversity×0.2');

  // impact < 2 제외
  const viable = newsList.filter(item => scoreImpact(item) >= 2);
  if (viable.length < newsList.length) {
    console.log(`    impact < 2 제외: ${newsList.length - viable.length}건, 후보 ${viable.length}건`);
  }
  // 전부 탈락하면 전체 목록 사용
  const pool = viable.length > 0 ? viable : newsList;

  const scored = pool.map(item => {
    const impact    = scoreImpact(item);
    // 기사 카테고리에 맞는 analysis 선택
    const itemCat   = inferTag(item).replace('오늘의 픽 · ', '').trim();
    const analysis  = analysisMap[itemCat] || { topics: [] };
    const represent = scoreRepresent(item, analysis);
    // 이 기사와 매칭되는 topic의 keywords[0]을 eventId object 추출에 활용
    const matchedKeyword = (() => {
      const text = item.title + ' ' + (item.content || '');
      let best = null, bestW = -1;
      for (const t of (analysis.topics || [])) {
        const hits = (t.keywords || []).filter(k => text.includes(k)).length;
        if (hits > 0 && t.weight > bestW) { bestW = t.weight; best = t; }
      }
      return best?.keywords?.[0] || null;
    })();
    const eid       = generateEventId(item, matchedKeyword);
    const { similarity, timestamp: simTs } = calcSimilarity(item, history, eid);
    const decay     = calcTimeDecay(nowMs, simTs);
    const diversity = (1 - similarity) * decay;
    const finalScore = combineScore(impact, represent, diversity);
    return { item, impact, represent, diversity, finalScore, eventId: eid };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);

  // 상위 3건 로그
  scored.slice(0, 3).forEach(({ item, impact, represent, diversity, finalScore, eventId: eid }, i) => {
    console.log(`    ${i + 1}위 [${finalScore.toFixed(2)}점 | impact:${impact} represent:${represent} diversity:${diversity.toFixed(2)}] [${eid}] ${item.title.slice(0, 40)}`);
  });

  const best = scored[0].item;
  const tag  = inferTag(best);

  return {
    title:   best.title,
    tag,
    emoji:   inferEmoji(tag),
    summary: makeSummary(best.content),
    link:    best.link,
    source:  inferSource(best.link),
    score:   scored[0].finalScore,
    date:    today,
    content: best.content,
    eventId: scored[0].eventId,
  };
}

async function main() {
  console.log('🚀 main() 시작:', new Date().toISOString());
  console.log('[뉴스 선정 시작]', new Date().toLocaleString('ko-KR'));

  // 선택 이력 로드 (diversity 계산에 사용)
  const history = loadHistory();
  console.log(`  이력 로드: ${history.length}건`);

  if (!NAVER_ID || !NAVER_SECRET) {
    throw new Error('NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET 환경변수가 없습니다.');
  }
  if (!OPENAI_KEY) {
    throw new Error('OPENAI_API_KEY 환경변수가 없습니다.');
  }

  // 여러 키워드로 뉴스 수집
  const allItems = [];
  for (const query of SEARCH_QUERIES) {
    try {
      const items = await fetchNaverNews(query);
      allItems.push(...items);
      console.log(`  [${query}] ${items.length}건 수집`);
    } catch (e) {
      console.warn(`  [${query}] 수집 실패:`, e.message);
    }
  }

  // HTML 태그 제거 + 중복 제거
  const cleaned = allItems.map(item => ({
    title: stripHtml(item.title),
    description: stripHtml(item.description || ''),
    pubDate: item.pubDate,
    link: item.originallink || item.link,
  }));
  const unique = deduplicateByTitle(cleaned);
  console.log(`  총 ${unique.length}건 (중복 제거 후)`);

  // 종합 요약 기사 제외
  const SUMMARY_KEYWORDS = ['이슈종합', '뉴스종합', '뉴스브리핑', '오늘의뉴스', '주요뉴스종합', '헤드라인종합'];
  const noSummary = unique.filter(item => !SUMMARY_KEYWORDS.some(kw => item.title.replace(/\s/g, '').includes(kw)));
  if (noSummary.length < unique.length) {
    console.log(`  종합 기사 제외: ${unique.length - noSummary.length}건 제거, ${noSummary.length}건 남음`);
  }

  // 칼럼/사설/기고 제외
  // 괄호 안에 해당 단어가 포함되면 제거 (예: [한창헌의 단상], [특파원 칼럼] 등)
  const OPINION_WORDS = ['칼럼', '사설', '오피니언', '기고', '포럼', '시론', '논평', '특별기고', '데스크', '기자수첩', '독자투고', '단상'];
  const filtered = noSummary.filter(item =>
    !OPINION_WORDS.some(w => new RegExp(`\\[[^\\]]*${w}[^\\]]*\\]`).test(item.title))
  );
  if (filtered.length < noSummary.length) {
    console.log(`  칼럼/사설 제외: ${noSummary.length - filtered.length}건 제거, ${filtered.length}건 남음`);
  }

  // 약한 뉴스 제외 — 제목 키워드 기반
  const WEAK_TITLE_WORDS = ['포럼', '행사', '세미나', '공유', '소개', '참석', '개최'];
  const noWeak = filtered.filter(item => {
    const hit = WEAK_TITLE_WORDS.find(w => item.title.includes(w));
    if (hit) console.log(`    [약한뉴스 제거] (${hit}) ${item.title.slice(0, 50)}`);
    return !hit;
  });
  if (noWeak.length < filtered.length) {
    console.log(`  약한 뉴스 제외: ${filtered.length - noWeak.length}건 제거, ${noWeak.length}건 남음`);
  }

  // 잘린 제목(...으로 끝나는 것) 원문에서 보정
  const truncated = noWeak.filter(item => item.title.endsWith('...'));
  if (truncated.length > 0) {
    console.log(`  제목 보정 중... (${truncated.length}건)`);
    await Promise.all(truncated.map(async item => {
      item.title = await fetchFullTitle(item.link, item.title);
    }));
  }

  // 원문 본문 크롤링 (병렬) — 실패하거나 짧은 기사 제외
  console.log('  원문 크롤링 중...');
  const crawled = await Promise.all(
    noWeak.map(async item => {
      const content = await fetchArticleContent(item.link);
      return content ? { ...item, content } : null;
    })
  );
  const withContent = crawled.filter(Boolean);
  console.log(`  크롤링 성공: ${withContent.length}건 / ${unique.length}건`);
  if (withContent.length === 0) throw new Error('크롤링 성공한 뉴스가 없습니다.');

  // ─── 잡탕 기사 필터 ────────────────────────────────────────────────────────
  const beforeMixed = withContent.length;
  const cleanContent = withContent.filter(item => {
    const r = isMixedContent(item);
    if (r.filtered) {
      console.log(`    [잡탕 제거] ${r.reason} | ${item.title.slice(0, 40)}`);
      return false;
    }
    return true;
  });
  if (cleanContent.length < beforeMixed) {
    console.log(`  잡탕 필터: ${beforeMixed - cleanContent.length}건 제거, ${cleanContent.length}건 남음`);
  }
  // 안전: 전부 제거되면 원본 유지
  const pool = cleanContent.length > 0 ? cleanContent : withContent;

  // ─── 추모일 강제 선택 ──────────────────────────────────────────────────────
  const memorial = getTodayMemorial();
  if (memorial) {
    const memorialNews = pool.filter(item =>
      memorial.keywords.some(kw => item.title.includes(kw) || (item.content || '').includes(kw))
    );
    if (memorialNews.length > 0) {
      console.log(`  🕯️ 추모일 (${memorial.name}) — 관련 뉴스 ${memorialNews.length}건, 추모 중심성 점수 계산 중...`);
      const best = pickMemorialNews(memorial, memorialNews);
      const tag  = `오늘의 픽 · 추모`;
      const selected = {
        title:   best.title,
        tag,
        emoji:   '🕯️',
        summary: makeSummary(best.content),
        link:    best.link,
        source:  inferSource(best.link),
        score:   99,
        date:    new Date().toISOString().slice(0, 10),
        content: best.content,
      };
      console.log(`  🕯️ 추모 기사 선정: ${best.title.slice(0, 50)}`);
      console.log('  캐릭터 반응 생성 중...');
      try {
        selected.reactions = await generateReactions(selected.title, selected.content);
      } catch (e) {
        console.warn('  반응 생성 실패:', e.message);
        selected.reactions = { junhyuk: '', hana: '' };
      }
      const category = '추모';
      const record = {
        date:      selected.date,
        title:     selected.title,
        content:   selected.content   || '',
        summary:   Array.isArray(selected.summary) ? selected.summary : [],
        tag:       selected.tag,
        category,
        analysis:  {
          topics:   [{ name: memorial.name + ' 추모', keywords: memorial.keywords.slice(0, 5), weight: 1 }],
          mainMood: '추모',
          reason:   '',
        },
        reactions: selected.reactions,
      };
      const { error: dbError } = await supabase.from('daily_news').upsert(record, { onConflict: 'date' });
      if (dbError) throw new Error('Supabase 저장 오류: ' + dbError.message);
      console.log('  Supabase 저장 완료');
      const jsonPath = require('path').join(__dirname, 'today-news.json');
      require('fs').writeFileSync(jsonPath, JSON.stringify({ ...record, link: selected.link, source: selected.source }, null, 2), 'utf8');
      console.log('  today-news.json 업데이트 완료');
      console.log('[완료] 추모일 뉴스 선정');
      return;
    } else {
      console.warn(`  ⚠ 추모일 (${memorial.name}) 관련 뉴스 없음 — 일반 선정으로 전환`);
    }
  }

  // GPT로 트렌드 분석 (카테고리별 병렬 실행)
  console.log('  GPT-4o-mini 트렌드 분석 중 (카테고리별)...');
  console.log('  사용키:', OPENAI_KEY?.slice(-6));

  // STEP 1. 카테고리별 그룹화
  const categoryGroups = {};
  for (const item of pool) {
    const cat = inferTag(item).replace('오늘의 픽 · ', '').trim();
    if (!categoryGroups[cat]) categoryGroups[cat] = [];
    categoryGroups[cat].push(item);
  }
  console.log(`  카테고리 그룹: ${Object.entries(categoryGroups).map(([c, v]) => `${c}(${v.length}건)`).join(', ')}`);

  // STEP 2. 카테고리별 analyzeTrend 병렬 실행
  const analysisMap = {};
  await Promise.all(
    Object.entries(categoryGroups).map(async ([cat, items]) => {
      if (items.length < 2) {
        // 기사가 1건뿐이면 GPT 호출 생략 — 단순 fallback
        analysisMap[cat] = { topics: [{ name: cat, keywords: [], weight: 1 }], mainMood: '', reason: '' };
        return;
      }
      try {
        analysisMap[cat] = await analyzeTrend(items, OPENAI_KEY);
        const top = (analysisMap[cat].topics || []).sort((a, b) => b.weight - a.weight)[0];
        console.log(`  [${cat}] ${analysisMap[cat].mainMood} — ${top?.keywords?.[0] || '?'}×${top?.weight || 0}`);
      } catch (e) {
        console.warn(`  [${cat}] analyzeTrend 실패:`, e.message);
        analysisMap[cat] = { topics: [], mainMood: '', reason: '' };
      }
    })
  );

  // 코드 기반 점수 계산 및 뉴스 선정
  console.log('  점수 계산 및 선정 중...');
  const selected = pickBestNews(pool, analysisMap, history);
  console.log(`  선정: [${selected.score.toFixed(2)}점] ${selected.title}`);

  // 캐릭터 반응 생성 (준혁 분석 + 하나 질문)
  console.log('  캐릭터 반응 생성 중...');
  try {
    selected.reactions = await generateReactions(selected.title, selected.content);
    console.log('  반응 생성 완료');
  } catch (e) {
    console.warn('  반응 생성 실패:', e.message);
    selected.reactions = { junhyuk: '', hana: '' };
  }

  // category 추론 (tag에서 추출)
  const category = selected.tag.replace('오늘의 픽 · ', '').trim();

  // Supabase daily_news 테이블에 upsert
  console.log('  Supabase 저장 중...');
  const record = {
    date:      selected.date,
    title:     selected.title,
    content:   selected.content   || '',
    summary:   Array.isArray(selected.summary) ? selected.summary : [],
    tag:       selected.tag       || '',
    category,
    source:    selected.source    || '',
    link:      selected.link      || '',
    analysis:  analysisMap[category] || {},
    reactions: selected.reactions || {},
  };
  const { error: dbError } = await supabase
    .from('daily_news')
    .upsert(record, { onConflict: 'date' });
  if (dbError) throw new Error('Supabase 저장 오류: ' + dbError.message);
  console.log('  Supabase 저장 완료');

  // 선택 이력 저장 (diversity 계산용)
  saveHistory(history, {
    title:     selected.title,
    content:   (selected.content || '').slice(0, 500),
    timestamp: new Date().toISOString(),
    eventId:   selected.eventId || '',
  });
  console.log('  이력 저장 완료');

  // today-news.json 동기화 (VS Code에서 확인용)
  const jsonPath = path.join(__dirname, 'today-news.json');
  fs.writeFileSync(jsonPath, JSON.stringify({ ...record, link: selected.link || '', source: inferSource(selected.link || '') }, null, 2), 'utf8');
  console.log('  today-news.json 업데이트 완료');

  // 저장된 토큰들에 푸시 알림 발송
  const SERVER_URL = process.env.SERVER_URL || 'https://repository-name-yoissue-serve.vercel.app';
  try {
    const notiRes = await fetch(`${SERVER_URL}/send-notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: selected.title, tag: selected.tag }),
    });
    const notiData = await notiRes.json();
    console.log(`  푸시 알림 발송: ${notiData.sent ?? 0}명`);
  } catch (e) {
    console.warn('  푸시 알림 발송 실패:', e.message);
  }

  console.log('[완료]');
}

module.exports = { main };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
