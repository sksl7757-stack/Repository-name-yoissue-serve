'use strict';

const { loadEnv } = require('./loadEnv');
const { supabase } = require('./supabase');

loadEnv();

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n📅 날짜: ${today}\n`);

  // news_raw 오늘치 개수
  const { count: rawTotal } = await supabase
    .from('news_raw')
    .select('*', { count: 'exact', head: true })
    .eq('date', today);

  const { count: rawProcessed } = await supabase
    .from('news_raw')
    .select('*', { count: 'exact', head: true })
    .eq('date', today)
    .eq('processed', true);

  console.log(`📥 news_raw: 총 ${rawTotal ?? 0}건 / 처리완료 ${rawProcessed ?? 0}건 / 미처리 ${(rawTotal ?? 0) - (rawProcessed ?? 0)}건`);
  console.log('─'.repeat(60));

  // daily_news 최신 1건
  const { data, error } = await supabase
    .from('daily_news')
    .select('*')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) { console.error('daily_news 조회 오류:', error.message); return; }
  if (!data)  { console.log('\n⚠️  daily_news 데이터 없음'); return; }

  console.log(`\n📰 daily_news 최신 (${data.date})`);
  console.log('─'.repeat(60));
  console.log(`제목:     ${data.title}`);
  console.log(`카테고리: ${data.category}  |  태그: ${data.tag}  |  이모지: ${data.emoji}`);
  console.log(`출처:     ${data.source}  |  기분: ${data.mood}  |  점수: ${data.score}`);
  console.log(`푸시발송: ${data.pushed ? '✅ 완료' : '❌ 미발송'}`);

  console.log('\n[summary]');
  const summary = data.summary || [];
  summary.forEach((s, i) => console.log(`  ${i + 1}. ${s || '(없음)'}`));

  console.log('\n[reactions]');
  const r = data.reactions || {};
  console.log(`  준혁: ${r.junhyuk || '(없음)'}`);
  console.log(`  하나: ${r.hana    || '(없음)'}`);

  console.log('\n[analysis]');
  const a = data.analysis || {};
  if (!a.topics || a.topics.length === 0) {
    console.log('  (없음)');
  } else {
    console.log(`  mainMood: ${a.mainMood || '-'}  |  reason: ${a.reason || '-'}`);
    (a.topics || []).forEach(t => {
      console.log(`  · ${t.name} [weight:${t.weight}] — ${(t.keywords || []).join(', ')}`);
    });
  }

  console.log('\n[content 앞 200자]');
  console.log(' ', (data.content || '(없음)').slice(0, 200));
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
