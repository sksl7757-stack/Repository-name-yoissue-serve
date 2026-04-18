'use strict';

// Stage 2: 처리 — news_raw에서 로드 → 크롤링 → 트렌드분석 → 선정 → 반응생성 → 저장

const { loadEnv }          = require('./loadEnv');
const { supabase }         = require('./supabase');
const { scoreImpact }      = require('./scoreImpact');
const { analyzeTrend }     = require('./analyzeTrend');
const { scoreRepresent }   = require('./scoreRepresent');
const { combineScore }     = require('./combineScore');
const { calcSimilarity }   = require('./similarity');
const { calcTimeDecay }    = require('./timeDecay');
const { loadHistory, saveHistory } = require('./historyStore');
const { generateEventId }  = require('./eventId');
const { extractKeywords }  = require('./services/keywordExtractor');
const { stripHtml }        = require('./stripHtml');

loadEnv();

const OPENAI_KEY = (process.env.OPENAI_API_KEY || '').replace(/['"]/g, '').replace(/[^\x20-\x7E]/g, '');

// ─── 추모일 ───────────────────────────────────────────────────────────────────

const MEMORIAL_DAYS = [
  { mmdd: '04-03', name: '제주 4·3',  keywords: ['4·3', '4.3', '제주4·3', '제주 4·3', '제주4.3', '사월삼일', '추모', '희생자', '분향', '기억'] },
  { mmdd: '04-16', name: '세월호',    keywords: ['세월호', '4·16', '4.16', '세월호 참사', '세월호참사', '추모', '희생자', '유가족', '분향', '기억'] },
  { mmdd: '05-18', name: '5·18',      keywords: ['5·18', '5.18', '광주민주화', '광주항쟁', '오월항쟁', '추모', '희생자', '기념', '묵념'] },
  { mmdd: '10-29', name: '이태원',    keywords: ['이태원', '10·29', '10.29', '이태원 참사', '이태원참사', '추모', '희생자', '유가족', '분향'] },
];

const MEMORIAL_TITLE_WORDS   = ['추모', '기념', '기억', '분향', '헌화'];
const MEMORIAL_CONTENT_WORDS = ['희생자', '유가족', '추모식', '기억식', '묵념'];

function getTodayMemorial() {
  const mmdd = new Date().toISOString().slice(5, 10);
  return MEMORIAL_DAYS.find(m => m.mmdd === mmdd) || null;
}

function pickMemorialNews(memorial, candidates) {
  const scored = candidates.map(item => {
    const title   = item.title   || '';
    const content = item.content || '';
    let score = 0;

    if (MEMORIAL_TITLE_WORDS.some(w => title.includes(w)))   score += 5;
    if (title.includes(memorial.name))                        score += 3;
    if (MEMORIAL_CONTENT_WORDS.some(w => content.includes(w))) score += 2;
    const eid = generateEventId(item, memorial.name);
    if (eid.includes('추모') || eid.includes('memorial'))     score += 5;

    return { item, score };
  });

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

// ─── 카테고리 ─────────────────────────────────────────────────────────────────

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
  '정치': '🏛️', '국제': '🌍', '건강': '🏥', '환경': '🌱', '문화': '🎭', '사회': '👥',
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
  'nocutnews.co.kr': '노컷뉴스',
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

function makeSummary(content) {
  if (!content) return ['내용을 불러오지 못했습니다.', '', ''];
  const sentences = content
    .split(/(?<=[다했요음죠임]\.)\s+|[。!?]\s+/)
    .map(s => s.trim().replace(/\s+/g, ' '))
    .filter(s => s.length >= 10);
  const result = sentences.slice(0, 3).map(s => s.slice(0, 25));
  while (result.length < 3) result.push('');
  return result;
}

// ─── 잡탕 기사 필터 ───────────────────────────────────────────────────────────

function isMixedContent(item) {
  const content = item.content || '';

  // [B-1] 줄임표 3회 이상
  const ellipsisCount = (content.match(/…/g) || []).length;
  if (ellipsisCount >= 3) return { filtered: true, reason: `B-줄임표×${ellipsisCount}` };

  // [B-2] 제목형 짧은 문장 5개 이상 + 비율 60% 이상
  const sentences = content.split(/[.!?。]\s+/).map(s => s.trim()).filter(s => s.length >= 5);
  if (sentences.length >= 5) {
    const shortCount = sentences.filter(s => s.length < 35).length;
    if (shortCount >= 5 && shortCount / sentences.length >= 0.6) {
      return { filtered: true, reason: `B-제목형문장×${shortCount}` };
    }
  }

  // [A] 4개 이상 카테고리에 키워드 분산
  const keywords = extractKeywords(item);
  if (keywords.length >= 6) {
    const hitCategories = new Set();
    for (const kw of keywords) {
      for (const { name, keywords: catKws } of CATEGORY_RULES) {
        if (catKws.some(ck => kw.includes(ck) || ck.includes(kw))) hitCategories.add(name);
      }
    }
    if (hitCategories.size >= 4) return { filtered: true, reason: `A-카테고리분산×${hitCategories.size}` };
  }

  // [C] 앞 2문장 vs 나머지 카테고리 불일치
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
      if (common.length === 0) return { filtered: true, reason: `C-주제불일치` };
    }
  }

  // [D] 긴 본문인데 키워드 반복 없음
  if (content.length > 800 && keywords.length >= 3) {
    const fullText    = (item.title || '') + ' ' + content;
    const anyRepeated = keywords.some(kw => {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (fullText.match(new RegExp(escaped, 'g')) || []).length >= 2;
    });
    if (!anyRepeated) return { filtered: true, reason: `D-키워드반복없음` };
  }

  return { filtered: false };
}

// ─── 크롤링 ───────────────────────────────────────────────────────────────────

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

    // 1. <p> 본문 파싱 + 품질 체크
    const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map(m => stripHtml(m[1]).trim())
      .filter(t => t.length > 10)
      .join(' ');
    if (paragraphs.length > 0) {
      const pResult = paragraphs.slice(0, 1000);
      if (!isMixedContent({ title: '', content: pResult }).filtered) return pResult;
    }

    // 2. div 본문 클래스 한정 파싱 + 품질 체크
    const divMatches = [...html.matchAll(/<div[^>]*class=["'][^"']*(article|content|news|body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)];
    const divContent = divMatches
      .map(m => stripHtml(m[2]).trim())
      .filter(t => t.length > 30)
      .join(' ');
    if (divContent.length > 150) {
      const dResult = divContent.slice(0, 1000);
      if (!isMixedContent({ title: '', content: dResult }).filtered) return dResult;
    }

    // 3. og:description fallback
    const ogMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
    if (ogMatch) return ogMatch[1].trim().slice(0, 1000);

    return null;
  } catch {
    return null;
  }
}

// ─── GPT: 반응 생성 ───────────────────────────────────────────────────────────

async function analyzeAndReact(title, content) {
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
  "mood": "긍정적|부정적|중립",
  "junhyuk": "준혁의 분석 한 줄",
  "hana": "하나의 공감 질문 (선택지 포함)"
}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
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

// ─── 뉴스 선정 ────────────────────────────────────────────────────────────────

function pickBestNews(newsList, analysisMap, history) {
  const nowMs = Date.now();

  console.log('    가중치: impact×0.5 + represent×0.3 + diversity×0.2');

  const pool = newsList;

  const scored = pool.map(item => {
    const impact   = scoreImpact(item);
    const itemCat  = inferTag(item).replace('오늘의 픽 · ', '').trim();
    const analysis = analysisMap[itemCat] || { topics: [] };
    const represent = scoreRepresent(item, analysis);

    const matchedKeyword = (() => {
      const text = item.title + ' ' + (item.content || '');
      let best = null, bestW = -1;
      for (const t of (analysis.topics || [])) {
        const hits = (t.keywords || []).filter(k => text.includes(k)).length;
        if (hits > 0 && t.weight > bestW) { bestW = t.weight; best = t; }
      }
      return best?.keywords?.[0] || null;
    })();

    const eid = generateEventId(item, matchedKeyword);
    const { similarity, timestamp: simTs } = calcSimilarity(item, history, eid);
    const decay      = calcTimeDecay(nowMs, simTs);
    const diversity  = (1 - similarity) * decay;
    const finalScore = combineScore(impact, represent, diversity);
    return { item, impact, represent, diversity, finalScore, eventId: eid };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);

  console.log('  [상위 3건]');
  scored.slice(0, 3).forEach(({ item, impact, represent, diversity, finalScore, eventId: eid }, i) => {
    console.log(`    ${i + 1}위 [${finalScore.toFixed(2)}점 | impact:${impact} rep:${represent.toFixed(2)} div:${diversity.toFixed(2)}] [${eid}] ${item.title.slice(0, 40)}`);
  });

  return scored[0];
}

// ─── 병렬 처리 유틸 ──────────────────────────────────────────────────────────

const CONCURRENCY = 5;

async function parallelMap(items, handler) {
  const results = [];
  const executing = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => handler(item));
    results.push(p);
    if (CONCURRENCY <= items.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= CONCURRENCY) await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now();
  console.log('🚀 [Stage 2] process-news 시작:', new Date().toISOString());

  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY 없음');

  const today    = new Date().toISOString().slice(0, 10);
  const memorial = getTodayMemorial();

  // 1. 미처리 뉴스 최대 30건 로드
  const { data: rawRows, error: loadErr } = await supabase
    .from('news_raw')
    .select('*')
    .eq('date', today)
    .eq('processed', false)
    .limit(30);

  if (loadErr) throw new Error('news_raw 로드 오류: ' + loadErr.message);
  if (!rawRows || rawRows.length === 0) {
    console.log('  처리할 뉴스 없음 (select-news가 먼저 실행되어야 함)');
    console.log(`✅ [Stage 2] 완료: ${Date.now() - start}ms`);
    return;
  }
  console.log(`  미처리 뉴스 ${rawRows.length}건 로드`);

  // 2. 병렬 크롤링 (최대 5 동시)
  console.log('  크롤링 중...');
  const withContent = await parallelMap(rawRows, async (row) => {
    const content = await fetchArticleContent(row.url);
    if (content) return { ...row, content };
    const fallbackContent = (row.description && row.description.length > 20)
      ? row.description
      : row.title;
    console.log(`  [FALLBACK] 크롤링 실패 → 대체 사용: ${row.title.slice(0, 40)}`);
    return { ...row, content: fallbackContent, isFallback: true };
  });
  console.log(`  병렬 크롤링 완료: ${withContent.length}건`);
  console.log(`  크롤링 성공: ${withContent.filter(i => !i.isFallback).length}건`);
  console.log(`  fallback 사용: ${withContent.filter(i => i.isFallback).length}건`);
  if (withContent.length === 0) {
    console.warn('  크롤링 성공 기사 없음');
    await markAllProcessed(rawRows);
    console.log(`✅ [Stage 2] 완료: ${Date.now() - start}ms`);
    return;
  }

  // 3. 잘린 제목 보정
  const truncated = withContent.filter(item => item.title.endsWith('...'));
  if (truncated.length > 0) {
    console.log(`  제목 보정 중... (${truncated.length}건)`);
    await Promise.all(truncated.map(async (item) => {
      item.title = await fetchFullTitle(item.url, item.title);
    }));
  }

  // 4. 잡탕 기사 필터
  const cleanContent = withContent.filter(item => {
    const r = isMixedContent(item);
    if (r.filtered) {
      console.log(`  [잡탕 제거] ${r.reason} | ${item.title.slice(0, 40)}`);
      return false;
    }
    return true;
  });
  const pool = cleanContent.length > 0 ? cleanContent : withContent;
  console.log(`  잡탕 필터 후: ${pool.length}건`);

  // 5. 이력 로드
  const history = loadHistory();
  console.log(`  이력 로드: ${history.length}건`);

  // 6. 추모일 강제 선택
  let selected, analysisMap = {};
  if (memorial) {
    const memorialNews = pool.filter(item =>
      memorial.keywords.some(kw => item.title.includes(kw) || (item.content || '').includes(kw))
    );
    if (memorialNews.length > 0) {
      console.log(`  🕯️ 추모일 (${memorial.name}) — 관련 뉴스 ${memorialNews.length}건`);
      const best = pickMemorialNews(memorial, memorialNews);
      selected = { item: best, finalScore: 99, eventId: generateEventId(best, memorial.name) };
    } else {
      console.warn(`  ⚠ 추모일 관련 뉴스 없음 — 일반 선정으로 전환`);
    }
  }

  // 7. 일반 선정 (카테고리별 analyzeTrend)
  if (!selected) {
    console.log('  GPT 트렌드 분석 중 (카테고리별)...');
    const categoryGroups = {};
    for (const item of pool) {
      const cat = inferTag(item).replace('오늘의 픽 · ', '').trim();
      if (!categoryGroups[cat]) categoryGroups[cat] = [];
      categoryGroups[cat].push(item);
    }
    console.log(`  카테고리: ${Object.entries(categoryGroups).map(([c, v]) => `${c}(${v.length}건)`).join(', ')}`);

    analysisMap = {};
    await Promise.all(
      Object.entries(categoryGroups).map(async ([cat, items]) => {
        if (items.length < 2) {
          const keywords = extractKeywords(items[0] || {});
          analysisMap[cat] = {
            topics: [{ name: cat, keywords: keywords.slice(0, 3), weight: 1 }],
            mainMood: '',
            reason: 'fallback',
          };
          return;
        }
        try {
          analysisMap[cat] = await analyzeTrend(items, OPENAI_KEY);
          const top = (analysisMap[cat].topics || []).sort((a, b) => b.weight - a.weight)[0];
          console.log(`  [${cat}] ${analysisMap[cat].mainMood} — ${top?.keywords?.[0] || '?'}`);
        } catch (e) {
          console.warn(`  [${cat}] analyzeTrend 실패:`, e.message);
          analysisMap[cat] = { topics: [], mainMood: '', reason: '' };
        }
      })
    );

    console.log(`  최종 후보 수: ${pool.length}건`);
    console.log('  점수 계산 및 선정 중...');
    const result = pickBestNews(pool, analysisMap, history);
    selected = result;
  }

  // 8. 반응 생성 (선정된 기사만)
  const best = selected.item;
  console.log(`  선정: [${selected.finalScore.toFixed ? selected.finalScore.toFixed(2) : selected.finalScore}점] ${best.title}`);
  console.log('  캐릭터 반응 생성 중...');
  let reactions = { junhyuk: '', hana: '' };
  let mood = '중립';
  try {
    const gpt = await analyzeAndReact(best.title, best.content);
    reactions = { junhyuk: gpt.junhyuk || '', hana: gpt.hana || '' };
    mood = gpt.mood || '중립';
    console.log('  반응 생성 완료');
  } catch (e) {
    console.warn('  반응 생성 실패:', e.message);
  }

  // 9. news_processed + daily_news 저장
  const tag      = memorial ? '오늘의 픽 · 추모' : inferTag(best);
  const category = tag.replace('오늘의 픽 · ', '').trim();
  const record   = {
    date:      today,
    title:     best.title,
    url:       best.url,
    content:   best.content,
    category,
    tag,
    emoji:     inferEmoji(tag),
    summary:   makeSummary(best.content),
    source:    inferSource(best.url),
    link:      best.url,
    mood,
    reactions,
    score:     selected.finalScore,
    pushed:    false,
    analysis:  analysisMap[category] || {},
  };

  const { error: insertErr } = await supabase.from('news_processed').insert(record);
  if (insertErr) console.error('  news_processed 저장 오류:', insertErr.message);
  else console.log('  news_processed 저장 완료');

  const { error: dailyErr } = await supabase.from('daily_news').upsert(record, { onConflict: 'date' });
  if (dailyErr) console.error('  daily_news 저장 오류:', dailyErr.message);
  else console.log('  daily_news 저장 완료');

  // 10. 이력 저장
  saveHistory(history, {
    title:     best.title,
    content:   (best.content || '').slice(0, 500),
    timestamp: new Date().toISOString(),
    eventId:   selected.eventId || '',
  });
  console.log('  이력 저장 완료');

  // 11. news_raw 전체 처리 완료 표시
  await markAllProcessed(rawRows);

  console.log(`✅ [Stage 2] 완료: ${Date.now() - start}ms`);
}

async function markAllProcessed(rows) {
  for (const row of rows) {
    await supabase.from('news_raw').update({ processed: true }).eq('id', row.id);
  }
}

module.exports = { main };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
