'use strict';
require('dotenv').config();
const { loadEnv } = require('./loadEnv');
loadEnv();

const NAVER_ID     = (process.env.NAVER_CLIENT_ID     || '').replace(/[^\x20-\x7E]/g, '');
const NAVER_SECRET = (process.env.NAVER_CLIENT_SECRET || '').replace(/[^\x20-\x7E]/g, '');

const TEST_QUERIES = [
  '부동산', '의료', '에너지', '복지', '노동', '안보', '주식', '관세',
];

async function fetchNaverNews(query) {
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=10&sort=date`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id':     NAVER_ID,
      'X-Naver-Client-Secret': NAVER_SECRET,
    },
  });
  const data = await res.json();
  return data.items || [];
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

(async () => {
  for (const query of TEST_QUERIES) {
    const items = await fetchNaverNews(query);
    console.log(`\n[${query}] ${items.length}건`);
    items.forEach((item, i) => {
      console.log(`  ${i + 1}. ${stripHtml(item.title)}`);
    });
  }
  process.exit(0);
})();
