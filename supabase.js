// supabase.js — Supabase 클라이언트 싱글톤 (지연 초기화)
const { createClient } = require('@supabase/supabase-js');
const { todayKST } = require('./dateUtil');

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

// ── 오보 recall 인메모리 deny set ────────────────────────────────────────
// Supabase soft delete(is_deleted=true) 와 중복 방어선. Railway 재시작 시 초기화되나
// 재시작 후에는 DB 컬럼이 권위 있는 기록이라 getTodayNews 쿼리가 알아서 걸러낸다.
// 동일 인스턴스 내에서 DELETE 호출 즉시 반영되게 하는 용도.
const DELETED_NEWS_IDS = new Set();

function markNewsDeleted(newsId) { if (newsId) DELETED_NEWS_IDS.add(newsId); }
function isNewsDeletedInMemory(newsId) { return newsId && DELETED_NEWS_IDS.has(newsId); }

/**
 * 오늘 날짜(YYYY-MM-DD)의 뉴스 레코드를 반환.
 * is_deleted=true 행은 제외. 인메모리 deny set 도 중복 체크.
 * 없거나 삭제된 경우 null 반환.
 */
async function getTodayNews() {
  const today = todayKST();
  if (isNewsDeletedInMemory(today)) return null;
  const { data, error } = await supabase
    .from('daily_news')
    .select('*')
    .eq('date', today)
    .eq('is_deleted', false)
    .maybeSingle();
  if (error) throw new Error('Supabase 조회 오류: ' + error.message);
  return data;
}

module.exports = { supabase, getTodayNews, markNewsDeleted, isNewsDeletedInMemory };
