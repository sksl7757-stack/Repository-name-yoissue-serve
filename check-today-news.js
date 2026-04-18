require('dotenv').config();
const { getTodayNews } = require('./supabase');

(async () => {
  const news = await getTodayNews();
  if (!news) {
    console.log('❌ 오늘 뉴스 없음');
    return;
  }
  console.log('═══════════════════════════════════════');
  console.log('📰 오늘의 뉴스');
  console.log('═══════════════════════════════════════');
  console.log('제목:', news.title);
  console.log('카테고리:', news.category);
  console.log('태그:', news.tag);
  console.log('무드:', news.mood);
  console.log('---------------------------------------');
  console.log('요약:', news.summary);
  console.log('---------------------------------------');
  console.log('content 길이:', news.content?.length);
  console.log('content:');
  console.log(news.content);
  console.log('---------------------------------------');
  console.log('하나 반응:', news.reactions?.hana);
  console.log('준혁 반응:', news.reactions?.junhyuk);
  process.exit(0);
})();
