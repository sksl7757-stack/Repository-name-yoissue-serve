'use strict';

// Stage 1: 수집만 — Naver API 호출 + 필터링 → news_raw 저장 (크롤링 없음)

const { loadEnv } = require('./loadEnv');
const { supabase } = require('./supabase');

loadEnv();

console.log('🔥 select-news 모듈 로드됨:', new Date().toISOString());

const NAVER_ID     = (process.env.NAVER_CLIENT_ID     || '').replace(/[^\x20-\x7E]/g, '');
const NAVER_SECRET = (process.env.NAVER_CLIENT_SECRET || '').replace(/[^\x20-\x7E]/g, '');

console.log(`[키 확인] NAVER_ID: "${NAVER_ID.slice(0, 5)}..." (길이: ${NAVER_ID.length})`);

const SEARCH_QUERIES = ['속보', '주요뉴스', '경제이슈', '사회이슈', '화제'];

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

function deduplicateByTitle(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.title.slice(0, 20);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const SUMMARY_KEYWORDS = ['이슈종합', '뉴스종합', '뉴스브리핑', '오늘의뉴스', '주요뉴스종합', '헤드라인종합'];
const OPINION_WORDS    = ['칼럼', '사설', '오피니언', '기고', '포럼', '시론', '논평', '특별기고', '데스크', '기자수첩', '독자투고', '단상'];
const WEAK_TITLE_WORDS = ['포럼', '행사', '세미나', '공유', '소개', '참석', '개최'];

async function main() {
  const start = Date.now();
  console.log('🚀 [Stage 1] select-news 시작:', new Date().toISOString());

  if (!NAVER_ID || !NAVER_SECRET) throw new Error('NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET 환경변수 없음');

  const today = new Date().toISOString().slice(0, 10);

  // 1. Naver API 수집
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

  // 2. HTML 제거 + 중복 제거 + 필터링
  const cleaned = allItems.map(item => ({
    title:       stripHtml(item.title),
    description: stripHtml(item.description || ''),
    pubDate:     item.pubDate,
    link:        item.originallink || item.link,
  }));
  const unique    = deduplicateByTitle(cleaned);
  const noSummary = unique.filter(item => !SUMMARY_KEYWORDS.some(kw => item.title.replace(/\s/g, '').includes(kw)));
  const noOpinion = noSummary.filter(item => !OPINION_WORDS.some(w => new RegExp(`\\[[^\\]]*${w}[^\\]]*\\]`).test(item.title)));
  const noWeak    = noOpinion.filter(item => !WEAK_TITLE_WORDS.find(w => item.title.includes(w)));
  console.log(`  정제 후: ${noWeak.length}건 (원본 ${allItems.length}건)`);

  if (noWeak.length === 0) throw new Error('필터링 후 남은 뉴스 없음');

  // 3. 오늘 기존 rows 삭제 후 새로 저장
  await supabase.from('news_raw').delete().eq('date', today);
  const rows = noWeak.map(item => ({
    date:        today,
    title:       item.title,
    url:         item.link,
    description: item.description || '',
    processed:   false,
  }));
  const { error } = await supabase.from('news_raw').insert(rows);
  if (error) throw new Error('news_raw 저장 오류: ' + error.message);
  console.log(`  news_raw 저장 완료: ${rows.length}건`);

  console.log(`✅ [Stage 1] 완료: ${Date.now() - start}ms`);
}

module.exports = { main };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
