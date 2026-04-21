require('dotenv').config();
const { supabase } = require('./supabase');
const { todayKST } = require('./dateUtil');

(async () => {
  const today = todayKST();
  console.log('오늘 날짜:', today);

  // 1. daily_news
  const { error: e1 } = await supabase.from('daily_news').delete().eq('date', today);
  console.log('daily_news 삭제:', e1 ? '❌ ' + e1.message : '✅');

  // 2. news_processed
  const { error: e2 } = await supabase.from('news_processed').delete().eq('date', today);
  console.log('news_processed 삭제:', e2 ? '❌ ' + e2.message : '✅');

  // 3. news_raw
  const { error: e3 } = await supabase.from('news_raw').delete().eq('date', today);
  console.log('news_raw 삭제:', e3 ? '❌ ' + e3.message : '✅');

  // 4. Storage 이미지 (오늘 폴더)
  const { data: folders } = await supabase.storage.from('yoissue-images').list(today);
  if (folders && folders.length > 0) {
    const paths = [];
    for (const char of folders) {
      const { data: sub } = await supabase.storage.from('yoissue-images').list(`${today}/${char.name}`);
      if (sub) {
        for (const type of sub) {
          const { data: files } = await supabase.storage.from('yoissue-images').list(`${today}/${char.name}/${type.name}`);
          if (files) {
            for (const emotion of files) {
              const { data: imgs } = await supabase.storage.from('yoissue-images').list(`${today}/${char.name}/${type.name}/${emotion.name}`);
              if (imgs) imgs.forEach(img => paths.push(`${today}/${char.name}/${type.name}/${emotion.name}/${img.name}`));
            }
          }
        }
      }
    }
    if (paths.length > 0) {
      const { error: e4 } = await supabase.storage.from('yoissue-images').remove(paths);
      console.log(`Storage ${paths.length}개 삭제:`, e4 ? '❌ ' + e4.message : '✅');
    } else {
      console.log('Storage: 삭제할 이미지 없음');
    }
  } else {
    console.log('Storage: 오늘 폴더 없음');
  }

  // 5. 로컬 상태 파일
  const fs = require('fs');
  const path = require('path');
  const stateFile = path.join(__dirname, '.generated-state.json');
  if (fs.existsSync(stateFile)) {
    fs.unlinkSync(stateFile);
    console.log('.generated-state.json 삭제: ✅');
  } else {
    console.log('.generated-state.json: 없음');
  }

  // news-history.json은 유지 (어제 이력 보존)

  console.log('\n오늘 데이터 초기화 완료. 다시 select-news → process-news 실행 가능.');
  process.exit(0);
})();
