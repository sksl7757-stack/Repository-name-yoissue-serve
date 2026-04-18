'use strict';

// Stage 3: 푸시 발송 — news_processed에서 오늘 미발송 항목 조회 → 발송 → pushed=true

const { loadEnv } = require('./loadEnv');
const { supabase } = require('./supabase');

loadEnv();

async function main() {
  const start = Date.now();
  console.log('🚀 [Stage 3] send-push 시작:', new Date().toISOString());

  const today = new Date().toISOString().slice(0, 10);

  const { data: items, error } = await supabase
    .from('news_processed')
    .select('*')
    .eq('date', today)
    .eq('pushed', false);

  if (error) throw new Error('news_processed 로드 오류: ' + error.message);
  if (!items || items.length === 0) {
    console.log('  발송할 뉴스 없음 (아직 처리 중이거나 이미 발송됨)');
    console.log(`✅ [Stage 3] 완료: ${Date.now() - start}ms`);
    return;
  }

  console.log(`  미발송 항목 ${items.length}건`);

  const SERVER_URL = process.env.SERVER_URL || 'https://repository-name-yoissue-serve.vercel.app';

  for (const item of items) {
    try {
      const res = await fetch(`${SERVER_URL}/send-notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: item.title, tag: item.tag }),
      });
      const data = await res.json();
      console.log(`  푸시 발송: ${data.sent ?? 0}명 — ${item.title.slice(0, 40)}`);

      await supabase
        .from('news_processed')
        .update({ pushed: true })
        .eq('id', item.id);
    } catch (err) {
      console.error('push failed:', err.message);
    }
  }

  console.log(`✅ [Stage 3] 완료: ${Date.now() - start}ms`);
}

module.exports = { main };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
