const { loadEnv } = require('./loadEnv');
const { supabase } = require('./supabase');
const { analyzeTrend }  = require('./analyzeTrend');
const { scoreImpact }   = require('./scoreImpact');
const { scoreRepresent } = require('./scoreRepresent');
const { combineScore, resolveWeights } = require('./combineScore');

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
    return match[1].replace(/\s*[\||\-–—]\s*.{1,20}$/, '').trim() || fallback;
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

const CATEGORY_MAP = [
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
  'IT': '💻', '금융': '💰', '경제': '📈', '부동산': '🏠',
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

function pickBestNews(newsList, analysis) {
  const today = new Date().toISOString().slice(0, 10);

  const { wImpact, wRepresent, label } = resolveWeights(analysis);
  console.log(`    가중치: impact×${wImpact} + represent×${wRepresent} (${label})`);

  const scored = newsList.map(item => {
    const impact    = scoreImpact(item);
    const represent = scoreRepresent(item, analysis);
    const finalScore = combineScore(impact, represent, analysis);
    return { item, impact, represent, finalScore };
  });

  const QUALITY_THRESHOLD   = 2.5;
  const REPRESENT_MIN_SCORE = 2;

  scored.sort((a, b) => b.finalScore - a.finalScore);

  // 상위 3건 로그 (필터링 전 전체 기준)
  scored.slice(0, 3).forEach(({ item, impact, represent, finalScore }, i) => {
    console.log(`    ${i + 1}위 [impact:${impact}×${wImpact} + represent:${represent}×${wRepresent} = ${finalScore.toFixed(2)}점] ${item.title.slice(0, 40)}`);
  });

  // represent 기준 미달 뉴스 제거 (트렌드 무관 뉴스 차단)
  const candidates = scored.filter(({ represent }) => represent > REPRESENT_MIN_SCORE);
  if (candidates.length < scored.length) {
    console.log(`    represent ≤ ${REPRESENT_MIN_SCORE} 제외: ${scored.length - candidates.length}건 탈락, 후보 ${candidates.length}건 남음`);
  }
  // 모두 탈락하면 전체 목록으로 fallback
  const pool = candidates.length > 0 ? candidates : scored;

  // 선택 품질 검사 (pool 기준)
  const topScore = pool[0].finalScore;
  let best;

  if (topScore <= QUALITY_THRESHOLD) {
    console.warn(`  ⚠ 선택 품질 낮음 (최고점 ${topScore.toFixed(2)} ≤ ${QUALITY_THRESHOLD}): 대표성이 부족한 날로 판단`);

    // fallback: pool 내에서 represent 점수가 가장 높은 뉴스 선택
    const fallback = [...pool].sort((a, b) => b.represent - a.represent)[0];
    console.warn(`  ↩ fallback 선택 [represent:${fallback.represent}점] ${fallback.item.title.slice(0, 40)}`);
    best = fallback.item;
  } else {
    best = pool[0].item;
  }
  const tag  = inferTag(best);

  return {
    title:  best.title,
    tag,
    emoji:  inferEmoji(tag),
    summary: makeSummary(best.content),
    link:   best.link,
    source: inferSource(best.link),
    score:  scored[0].finalScore,
    date:   today,
    content: best.content,
  };
}

async function main() {
  console.log('🚀 main() 시작:', new Date().toISOString());
  console.log('[뉴스 선정 시작]', new Date().toLocaleString('ko-KR'));

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

  // 잘린 제목(...으로 끝나는 것) 원문에서 보정
  const truncated = unique.filter(item => item.title.endsWith('...'));
  if (truncated.length > 0) {
    console.log(`  제목 보정 중... (${truncated.length}건)`);
    await Promise.all(truncated.map(async item => {
      item.title = await fetchFullTitle(item.link, item.title);
    }));
  }

  // 원문 본문 크롤링 (병렬) — 실패하거나 짧은 기사 제외
  console.log('  원문 크롤링 중...');
  const crawled = await Promise.all(
    unique.map(async item => {
      const content = await fetchArticleContent(item.link);
      return content ? { ...item, content } : null;
    })
  );
  const withContent = crawled.filter(Boolean);
  console.log(`  크롤링 성공: ${withContent.length}건 / ${unique.length}건`);
  if (withContent.length === 0) throw new Error('크롤링 성공한 뉴스가 없습니다.');

  // GPT로 트렌드 분석 (1회 호출)
  console.log('  GPT-4o-mini 트렌드 분석 중...');
  console.log('  사용키:', OPENAI_KEY?.slice(-6));
  const analysis = await analyzeTrend(withContent, OPENAI_KEY);
  console.log(`  트렌드: [${analysis.mainKeyword}] ${analysis.mainMood} — ${analysis.mainTopic}`);

  // 코드 기반 점수 계산 및 뉴스 선정
  console.log('  점수 계산 및 선정 중...');
  const selected = pickBestNews(withContent, analysis);
  console.log(`  선정: [${selected.score}점] ${selected.title}`);

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
    analysis:  analysis           || {},
    reactions: selected.reactions || {},
  };
  const { error: dbError } = await supabase
    .from('daily_news')
    .upsert(record, { onConflict: 'date' });
  if (dbError) throw new Error('Supabase 저장 오류: ' + dbError.message);
  console.log('  Supabase 저장 완료');

  // 집 PC yoissue-server로 이미지 생성 트리거 (SD_LOCAL_URL = ngrok port 4000)
  const SD_LOCAL_URL = process.env.SD_LOCAL_URL;
  if (SD_LOCAL_URL) {
    try {
      console.log('  이미지 생성 트리거 중...');
      const triggerRes = await fetch(`${SD_LOCAL_URL}/start-image-generation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, tag: selected.tag, title: selected.title }),
      });
      const triggerData = await triggerRes.json();
      console.log('  이미지 생성 트리거 완료:', triggerData);
    } catch (e) {
      console.warn('  이미지 생성 트리거 실패:', e.message);
    }
  } else {
    console.warn('  SD_LOCAL_URL 미설정 — 이미지 생성 스킵');
  }

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
