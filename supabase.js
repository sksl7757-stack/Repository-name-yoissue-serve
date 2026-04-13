// supabase.js — Supabase 클라이언트 싱글톤 (지연 초기화)
const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getClient() {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
    );
  }
  return _client;
}

// supabase.xxx() 호출 시 자동으로 클라이언트를 반환하는 Proxy
const supabase = new Proxy({}, {
  get(_, prop) {
    return getClient()[prop];
  },
});

/**
 * 오늘 날짜(YYYY-MM-DD)의 뉴스 레코드를 반환.
 * 없으면 null 반환.
 */
async function getTodayNews() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('daily_news')
    .select('*')
    .eq('date', today)
    .maybeSingle();
  if (error) throw new Error('Supabase 조회 오류: ' + error.message);
  return data;
}

module.exports = { supabase, getTodayNews };
