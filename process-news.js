'use strict';

// Stage 2: 처리 — news_raw에서 로드 → 크롤링 → 트렌드분석 → 선정 → 반응생성 → 저장

const { loadEnv }          = require('./loadEnv');
const { supabase }         = require('./supabase');
const { loadHistory } = require('./historyStore');
const { stripHtml }        = require('./stripHtml');
const { todayKST, mmddKST } = require('./dateUtil');
const { classifyMourning } = require('./newsInterpreter');

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
  const mmdd = mmddKST();
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

// 단일 카테고리 리스트 — inferTag(태깅)과 isMixedContent([C] 드리프트 판정) 양쪽에서 공용.
// 순서가 동점 처리 시 우선순위 (inferTag: 같은 점수면 앞쪽 항목 채택).
const CATEGORIES = [
  { name: '추모',   keywords: ['세월호', '이태원', '5·18', '5.18', '4·3', '광주민주화', '광주항쟁'] },
  { name: 'IT',     keywords: ['인공지능', '생성형AI', 'AI모델', 'AI칩', 'AI반도체', 'AI서비스', '반도체', '빅테크', '구글', '삼성전자', '메타', '오픈AI', '챗GPT', '소프트웨어', '스타트업'] },
  { name: '금융',   keywords: ['금리', '주가', '증시', '코스피', '코스닥', '달러', '환율', '채권', '은행', '금융', '연준', 'FOMC', '기준금리', '파월', '통화정책'] },
  { name: '안보',   keywords: ['북한', '미사일', '핵', '안보', '군사', '국방', '합참', 'NATO', '나토', '병력', '도발'] },
  { name: '국제',   keywords: ['미국', '중국', '러시아', '유럽', '이란', '트럼프', '바이든', '시진핑', '푸틴', '북한'] },
  { name: '경제',   keywords: ['경제', '물가', '관세', '무역', '수출', '수입', 'GDP', '인플레', '성장률', '소비자', '소매판매', '고용지표', '실업률', '거시경제', '경기침체', '청문회', 'FTA', '자유무역', '무역협정', '재협상'] },
  { name: '부동산', keywords: ['부동산', '아파트', '주택', '전세', '집값', '분양', '임대'] },
  { name: '정치',   keywords: ['국회', '대통령', '여당', '야당', '선거', '정당', '탄핵', '의원', '정치'] },
  { name: '건강',   keywords: ['의료', '건강', '병원', '백신', '바이러스', '코로나', '암', '질병'] },
  { name: '환경',   keywords: ['기후', '탄소', '환경', '에너지', '원전', '태양광'] },
  { name: '문화',   keywords: ['영화', '음악', '드라마', '문화', '예술', 'BTS', 'K팝', '아이돌', '공연'] },
  { name: '스포츠', keywords: ['축구', '야구', '농구', '올림픽', '월드컵', '선수', '경기', '리그'] },
  { name: '사회',   keywords: ['사건', '사고', '범죄', '복지', '교육', '학교', '노동'] },
];

const CATEGORY_EMOJI = {
  '추모': '🕯️', 'IT': '💻', '금융': '💰', '경제': '📈', '부동산': '🏠',
  '안보': '🛡️', '정치': '🏛️', '국제': '🌍', '건강': '🏥', '환경': '🌱', '문화': '🎭', '사회': '👥',
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
  let best = { name: '사회', count: 0, index: 999 };

  CATEGORIES.forEach((cat, index) => {
    const count = cat.keywords.filter(k => text.includes(k)).length;
    if (count > best.count || (count === best.count && count > 0 && index < best.index)) {
      best = { name: cat.name, count, index };
    }
  });

  return `오늘의 픽 · ${best.name}`;
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

// ─── 제목 중복 제거 ───────────────────────────────────────────────────────────

function deduplicateByTitle(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.title
      .replace(/\[속보\]|\[단독\]|\[긴급\]/g, '')
      .trim()
      .slice(0, 20);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

  // [C] 앞 2문장 vs 나머지 카테고리 불일치
  if (sentences.length >= 5) {
    const getCats = text => {
      const cats = new Set();
      for (const { name, keywords: catKws } of CATEGORIES) {
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

function stripStyleAndScript(html) {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

// 크롤링 결과가 실제 뉴스 본문이 아닌 안내/경고문인지 판별
function isInvalidContent(text) {
  if (!text || text.length < 30) return true;

  const head = text.slice(0, 300); // 앞부분만 검사 (본문은 보통 정상 문장으로 시작)

  const INVALID_PATTERNS = [
    // 브라우저 경고
    /Internet Explorer/i,
    /브라우저를?\s*업(데이트|그레이드)/,
    /최신\s*브라우저/,
    /크롬.*다운로드/i,
    /Chrome.*download/i,

    // 페이월/로그인 요구
    /로그인\s*(후|하면|하고)\s*(이용|열람|확인|보실)/,
    /회원\s*가입\s*(후|하면|하고)/,
    /유료\s*(기사|콘텐츠|구독)/,
    /구독(자|회원).*이용/,

    // CSS/JS 코드 잔재
    /#[\w-]+\s*\{/,
    /\.[\w-]+\s*\{[^}]*:/,
    /\{\s*(position|overflow|margin|padding|display|color|font)\s*:/,
    /<script[\s>]/i,
    /window\.\w+\s*=/,

    // 네비게이션/광고 잔재
    /^(홈|뉴스|경제|사회|정치|문화|스포츠|연예)\s*(›|>|»)/,
    /광고문의|제휴문의|이용약관|개인정보/,
    /^.{0,30}(기자|특파원)\s+[a-zA-Z0-9._%+-]+@/,

    // 신문사 푸터/저작권 정보
    /제호\s*[:：]/,
    /등록번호\s*[:：]/,
    /발행인\s*[·,]?\s*편집인/,
    /발행일자/,
    /Copyright.{0,30}All\s*rights?\s*reserved/i,
    /무단\s*(전재|복제|배포)/,
    /ⓒ\s*[\w가-힣]+(일보|신문|방송|뉴스)/,
    /대표전화\s*[:：]?\s*\d/,
  ];

  return INVALID_PATTERNS.some(p => p.test(head));
}

async function fetchArticleContent(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const rawHtml = await res.text();
    const html = stripStyleAndScript(rawHtml);

    // 1. <p> 본문 파싱 + 품질 체크
    const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map(m => stripHtml(m[1]).trim())
      .filter(t => t.length > 10)
      .join(' ');
    if (paragraphs.length > 0) {
      const pResult = paragraphs.slice(0, 1000);
      if (!isInvalidContent(pResult) && !isMixedContent({ title: '', content: pResult }).filtered) return pResult;
    }

    // 2. div 본문 클래스 한정 파싱 + 품질 체크
    const divMatches = [...html.matchAll(/<div[^>]*class=["'][^"']*(article|content|news|body)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)];
    const divContent = divMatches
      .map(m => stripHtml(m[2]).trim())
      .filter(t => t.length > 30)
      .join(' ');
    if (divContent.length > 150) {
      const dResult = divContent.slice(0, 1000);
      if (!isInvalidContent(dResult) && !isMixedContent({ title: '', content: dResult }).filtered) return dResult;
    }

    // 3. og:description fallback
    const ogMatch = rawHtml.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
      || rawHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
    if (ogMatch) {
      const ogText = ogMatch[1].trim().slice(0, 1000);
      if (!isInvalidContent(ogText)) return ogText;
    }

    return null;
  } catch {
    return null;
  }
}

// ─── 뉴스 선정 (GPT) ─────────────────────────────────────────────────────────

async function pickBestNews(newsList, history) {
  const today = todayKST();
  const recentTitles = history.slice(0, 7).map(h => h.title);

  const candidates = newsList.map((item, i) => ({
    index: i,
    title: item.title,
    source: inferSource(item.url || item.link || ''),
    summary: (item.content || item.description || '').slice(0, 150),
  }));

  const prompt = `오늘 날짜: ${today}

아래 뉴스 목록에서 오늘 한국 사람들이 가장 주목해야 할 뉴스 1개를 골라줘.

선정 기준 (우선순위 순):
1. 오늘 한국 및 세계에서 가장 크게 터진 사건/발표/정책
2. 파급력과 중요도가 큰 이슈
3. 단일 주제 기사 (여러 이슈 묶음 기사 제외)

반드시 제외:
- 지자체/기관 홍보성 보도자료
- 행사/세미나/포럼 안내
- 사설/칼럼/기고

출처 기준 (중요):
- 연합뉴스, 뉴시스, 뉴스1, YTN, KBS, MBC, SBS, JTBC,
  조선일보, 중앙일보, 동아일보, 한겨레, 경향신문,
  한국경제, 매일경제, 서울경제, 이데일리, 머니투데이
  위 주요 전국 매체 기사가 후보에 있으면 반드시 그 중에서 선택해라.
- 위 매체 기사가 하나도 없을 때만 소규모 매체 선택 가능.

최근 며칠간 이미 선정된 뉴스 (중복 피하기):
${recentTitles.length > 0 ? recentTitles.map((t, i) => `${i + 1}. ${t}`).join('\n') : '없음'}

뉴스 목록:
${candidates.map(c => `[${c.index}] ${c.title} (${c.source})\n    ${c.summary}`).join('\n\n')}

아래 JSON 형식으로만 응답:
{
  "selected_index": 숫자,
  "reason": "선정 이유 한 줄 (한국어)"
}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error('GPT 선정 오류: ' + data.error.message);

  const result = JSON.parse(data.choices[0].message.content);
  const idx = result.selected_index;

  if (idx === undefined || idx < 0 || idx >= newsList.length) {
    console.warn('  GPT 선정 index 오류, fallback: 0번');
    return newsList[0];
  }

  console.log(`  GPT 선정: [${idx}번] ${result.reason}`);
  return newsList[idx];
}

// ─── 병렬 처리 유틸 ──────────────────────────────────────────────────────────

const CONCURRENCY = 5;

async function parallelMap(items, handler) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await handler(items[i]);
    }
  }
  const workerCount = Math.min(CONCURRENCY, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now();
  console.log('🚀 [Stage 2] process-news 시작:', new Date().toISOString());

  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY 없음');

  const today    = todayKST();
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

  // 1-1. 크롤링 전 title 중복 제거 (불필요한 fetch 방지)
  const preCrawlRows = deduplicateByTitle(rawRows);
  console.log(`  크롤링 전 title dedup: ${rawRows.length - preCrawlRows.length}건 제거, ${preCrawlRows.length}건 크롤링`);

  // 2. 병렬 크롤링 (최대 5 동시)
  console.log('  크롤링 중...');
  const withContent = await parallelMap(preCrawlRows, async (row) => {
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

  // 4. 제목 중복 제거
  const deduped = deduplicateByTitle(withContent);
  console.log(`  제목 중복 제거: ${withContent.length - deduped.length}건 제거, ${deduped.length}건 남음`);

  // 5. 잡탕 기사 필터
  const cleanContent = deduped.filter(item => {
    const r = isMixedContent(item);
    if (r.filtered) {
      console.log(`  [잡탕 제거] ${r.reason} | ${item.title.slice(0, 40)}`);
      return false;
    }
    return true;
  });
  const pool = cleanContent.length > 0 ? cleanContent : deduped;
  console.log(`  잡탕 필터 후: ${pool.length}건`);

  // 6. 이력 로드
  const history = await loadHistory();
  console.log(`  이력 로드: ${history.length}건`);

  // 7. 추모일 강제 선택
  let selected;
  if (memorial) {
    const memorialNews = pool.filter(item =>
      memorial.keywords.some(kw => item.title.includes(kw) || (item.content || '').includes(kw))
    );
    if (memorialNews.length > 0) {
      console.log(`  🕯️ 추모일 (${memorial.name}) — 관련 뉴스 ${memorialNews.length}건`);
      const best = pickMemorialNews(memorial, memorialNews);
      selected = { item: best, finalScore: 99, eventId: '' };
    } else {
      console.warn(`  ⚠ 추모일 관련 뉴스 없음 — 일반 선정으로 전환`);
    }
  }

  // 8. GPT 선정
  if (!selected) {
    console.log('  GPT 뉴스 선정 중...');
    const best = await pickBestNews(pool, history);
    selected = { item: best, finalScore: 0, eventId: '' };
  }

  // 8. 반응 생성 (선정된 기사만)
  const best = selected.item;
  console.log(`  선정: [${selected.finalScore.toFixed ? selected.finalScore.toFixed(2) : selected.finalScore}점] ${best.title}`);
  // 9. news_processed + daily_news 저장
  const tag      = memorial ? '오늘의 픽 · 추모' : inferTag(best);
  const category = tag.replace('오늘의 픽 · ', '').trim();
  const summary  = makeSummary(best.content);

  // 추모/재난 판정: memorial 강제 선정이면 무조건 true, 아니면 GPT 판정
  let is_mourning_required = false;
  if (memorial) {
    is_mourning_required = true;
    console.log('  is_mourning_required=true (memorial 강제 선정)');
  } else {
    try {
      is_mourning_required = await classifyMourning({
        title: best.title,
        summary: Array.isArray(summary) ? summary.join(' ') : String(summary || ''),
      });
      console.log(`  is_mourning_required=${is_mourning_required} (GPT 판정)`);
    } catch (e) {
      console.warn('  classifyMourning 실패, false로 기본:', e.message);
    }
  }

  const record = {
    date:      today,
    title:     best.title,
    url:       best.url,
    content:   best.content,
    category,
    tag,
    emoji:     inferEmoji(tag),
    summary,
    source:    inferSource(best.url),
    link:      best.url,
    score:     selected.finalScore,
    pushed:    false,
    analysis:  {},
    is_mourning_required,
  };

  // 원자적 저장 + 재시도: 둘 다 성공해야 markAllProcessed 실행.
  // Supabase REST는 다중 테이블 트랜잭션 미지원 → news_processed 선저장 후 daily_news 실패 시 보상 롤백.
  // 일시적 네트워크/5xx 실패를 흡수하기 위해 30초 백오프로 최대 3회 시도 (초기 1 + 재시도 2).
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = 30_000;

  async function saveAttempt() {
    // 재실행 감지: raw 미처리 상태에서 오늘 news_processed 행이 있으면 고아 확정 → 정리.
    const { data: stale } = await supabase
      .from('news_processed')
      .select('id')
      .eq('date', today);
    if (stale && stale.length > 0) {
      console.warn(`  [재실행 감지] 이전 실패 잔재 news_processed ${stale.length}건 정리`);
      await supabase.from('news_processed').delete().eq('date', today);
    }

    const { data: inserted, error: insertErr } = await supabase
      .from('news_processed')
      .insert(record)
      .select('id')
      .single();
    if (insertErr) throw new Error('news_processed 저장 실패: ' + insertErr.message);

    const { error: dailyErr } = await supabase
      .from('daily_news')
      .upsert(record, { onConflict: 'date' });
    if (dailyErr) {
      console.error('  ❌ daily_news 저장 실패 — news_processed 롤백 시도:', dailyErr.message);
      const { error: rollbackErr } = await supabase
        .from('news_processed')
        .delete()
        .eq('id', inserted.id);
      if (rollbackErr) {
        console.error(`  ⚠⚠ 롤백 실패 — 다음 시도의 stale 정리가 처리 news_processed.id=${inserted.id}:`, rollbackErr.message);
      }
      throw new Error('daily_news 저장 실패: ' + dailyErr.message);
    }
    return inserted.id;
  }

  let savedId;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      savedId = await saveAttempt();
      console.log(`  ✅ 저장 완료 (attempt ${attempt}/${MAX_ATTEMPTS}, news_processed.id=${savedId})`);
      break;
    } catch (e) {
      console.warn(`  ⚠ 저장 실패 (attempt ${attempt}/${MAX_ATTEMPTS}): ${e.message}`);
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`저장 ${MAX_ATTEMPTS}회 모두 실패 — markAllProcessed 스킵, 다음 cron 재시도: ${e.message}`);
      }
      console.log(`  ${BACKOFF_MS / 1000}초 대기 후 재시도...`);
      await new Promise(r => setTimeout(r, BACKOFF_MS));
    }
  }

  // 저장 성공 — news_raw 처리 표시
  await markAllProcessed(rawRows);

  console.log(`✅ [Stage 2] 완료: ${Date.now() - start}ms`);
}

async function markAllProcessed(rows) {
  if (!rows || rows.length === 0) return;
  const ids = rows.map(r => r.id);
  const { error } = await supabase
    .from('news_raw')
    .update({ processed: true })
    .in('id', ids);
  if (error) console.warn('  ⚠ markAllProcessed 실패 (저장은 성공):', error.message);
}

module.exports = { main };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
