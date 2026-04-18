'use strict';

// Stage 1: 수집만 — Naver API 호출 + 필터링 → news_raw 저장 (크롤링 없음)

const { loadEnv } = require('./loadEnv');
const { supabase } = require('./supabase');

loadEnv();

const NAVER_ID     = (process.env.NAVER_CLIENT_ID     || '').replace(/[^\x20-\x7E]/g, '');
const NAVER_SECRET = (process.env.NAVER_CLIENT_SECRET || '').replace(/[^\x20-\x7E]/g, '');

const QUERY_CONFIG = {
  '속보':    8,
  '주요뉴스': 8,
  '경제이슈': 7,
  '사회이슈': 7,
  '화제':    6,
  '경제':    3,
  '산업':    3,
  '기업':    3,
  '기술':    3,
};

async function fetchNaverNews(query) {
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=10&sort=date`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id':     NAVER_ID,
      'X-Naver-Client-Secret': NAVER_SECRET,
    },
  });
  if (!res.ok) throw new Error(`네이버 API 오류: ${res.status}`);
  const data = await res.json();
  return data.items || [];
}

function stripHtml(str) {
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#0*39;/g, "'");
}

function deduplicateByUrl(items) {
  const seen = new Set();
  return items.filter(item => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
}

const SUMMARY_KEYWORDS = ['이슈종합', '뉴스종합', '뉴스브리핑', '오늘의뉴스', '주요뉴스종합', '헤드라인종합'];

const OPINION_WORDS = [
  '칼럼', '사설', '오피니언', '기고', '포럼', '시론', '논평',
  '특별기고', '데스크', '기자수첩', '독자투고', '단상',
];

function isOpinion(title) {
  if (title.includes('칼럼니스트')) return false;
  return OPINION_WORDS.some(word => title.includes(word));
}

const WEAK_PATTERNS = [
  '포럼 개최', '행사 개최', '세미나 개최',
  '간담회', '심포지엄', '컨퍼런스', '설명회', '기념식', '출범식',
];

function isWeakNews(title) {
  return WEAK_PATTERNS.some(pattern => title.includes(pattern));
}

function getQueryKey(query) {
  return query;
}

function scoreImpactTitle(title) {
  let score = 0;
  const STRONG_KEYWORDS    = ['금리', '환율', '관세', '반도체', 'AI', '인공지능', '대통령', '전쟁', '경제', '물가', '수출'];
  const IMPORTANT_ENTITIES = ['삼성', '애플', '구글', '정부', '미국', '중국'];
  const CHANGE_WORDS       = ['상승', '하락', '급등', '급락', '충격', '위기'];
  for (const k of STRONG_KEYWORDS)    if (title.includes(k)) score += 2;
  for (const e of IMPORTANT_ENTITIES) if (title.includes(e)) score += 1;
  for (const c of CHANGE_WORDS)       if (title.includes(c)) score += 1;
  return score;
}

async function main() {
  const start = Date.now();
  console.log('🚀 [Stage 1] select-news 시작:', new Date().toISOString());

  if (!NAVER_ID || !NAVER_SECRET) throw new Error('NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET 환경변수 없음');

  const today = new Date().toISOString().slice(0, 10);

  // 1. 키워드별 버킷 수집 + 필터 동시 적용
  const MAX_TOTAL    = 50;
  const queryBuckets = {};
  const overflowPool = [];

  for (const query in QUERY_CONFIG) {
    const maxPerQuery = QUERY_CONFIG[query];
    try {
      const items = await fetchNaverNews(query);
      const key = getQueryKey(query);
      if (!queryBuckets[key]) queryBuckets[key] = [];

      for (const raw of items) {
        const title       = stripHtml(raw.title);
        const description = stripHtml(raw.description || '');
        const link        = raw.originallink || raw.link;

        if (SUMMARY_KEYWORDS.some(kw => title.replace(/\s/g, '').includes(kw))) continue;
        if (isOpinion(title)) continue;
        if (isWeakNews(title)) continue;

        const item = { title, description, link };
        if (queryBuckets[key].length < maxPerQuery) {
          queryBuckets[key].push(item);
        } else {
          overflowPool.push(item);
        }
      }
      console.log(`  [${query}] ${queryBuckets[key].length}/${maxPerQuery}`);
    } catch (e) {
      console.warn(`  [${query}] 수집 실패:`, e.message);
    }
  }

  // 2. 최종 후보 구성 (키워드별 → overflow 보충 → MAX_TOTAL 컷)
  let finalItems = [];
  for (const key in queryBuckets) finalItems.push(...queryBuckets[key]);
  if (finalItems.length < MAX_TOTAL) {
    for (const item of overflowPool) {
      finalItems.push(item);
      if (finalItems.length >= MAX_TOTAL) break;
    }
  }
  finalItems = finalItems.slice(0, MAX_TOTAL);

  // 2-1. impact 계산 + 최소 컷 + 30개 제한
  const scored = finalItems.map(item => ({ ...item, impact: scoreImpactTitle(item.title) }));
  const MIN_IMPACT = 1;
  let selected30 = scored.filter(item => item.impact >= MIN_IMPACT);
  if (selected30.length > 30) {
    selected30.sort((a, b) => b.impact - a.impact);
    selected30 = selected30.slice(0, 30);
  }
  if (selected30.length < 30) {
    const need = 30 - selected30.length;
    const remaining = scored.filter(item => !selected30.includes(item)).slice(0, need);
    selected30 = selected30.concat(remaining);
  }
  const finalSelected = selected30.map(({ impact, ...rest }) => rest);
  console.log(`  최종 30개 선정: ${finalSelected.length}건`);

  // 3. URL 기준 중복 제거
  const unique = deduplicateByUrl(finalSelected);
  console.log(`  필터+수집: ${unique.length}건 (버킷합계 ${finalItems.length}건)`);

  if (unique.length === 0) throw new Error('필터링 후 남은 뉴스 없음');

  // 4. upsert — 중복 URL은 skip
  const rows = unique.map(item => ({
    date:        today,
    title:       item.title,
    url:         item.link,
    description: item.description || '',
    processed:   false,
  }));

  const { data: inserted, error } = await supabase
    .from('news_raw')
    .upsert(rows, { onConflict: 'url', ignoreDuplicates: true })
    .select();

  if (error) throw new Error('news_raw 저장 오류: ' + error.message);

  const insertedCount = inserted ? inserted.length : 0;
  const skippedCount  = rows.length - insertedCount;
  console.log(`  insert: ${insertedCount}건 / skip(중복): ${skippedCount}건`);

  console.log(`✅ [Stage 1] 완료: ${Date.now() - start}ms`);
}

module.exports = { main };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
