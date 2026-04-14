// records.js — 기록 저장/조회 (Supabase records 테이블)
const { supabase } = require('./supabase');

/**
 * 기록 저장 — 같은 newsId는 1번만
 * @param {string} userId
 * @param {{ newsId, title, character, userChoice, createdAt }} record
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function addRecord(userId, record) {
  const { data: existing, error: selectError } = await supabase
    .from('records')
    .select('news_id')
    .eq('user_id', userId)
    .eq('news_id', record.newsId)
    .maybeSingle();

  if (selectError) throw new Error('Supabase 조회 오류: ' + selectError.message);
  if (existing) return { success: false, message: '이미 저장됨' };

  const { error: insertError } = await supabase
    .from('records')
    .insert({
      user_id: userId,
      news_id: record.newsId,
      title: record.title,
      character: record.character,
      user_choice: record.userChoice,
      created_at: record.createdAt || new Date().toISOString(),
    });

  if (insertError) throw new Error('Supabase 저장 오류: ' + insertError.message);
  return { success: true };
}

/**
 * 유저의 기록 목록 조회 (최신순)
 * @param {string} userId
 * @returns {Promise<Array>}
 */
async function getRecords(userId) {
  const { data, error } = await supabase
    .from('records')
    .select('news_id, title, character, user_choice, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error('Supabase 조회 오류: ' + error.message);
  return (data || []).map(r => ({
    newsId: r.news_id,
    title: r.title,
    character: r.character,
    userChoice: r.user_choice,
    createdAt: r.created_at,
  }));
}

module.exports = { addRecord, getRecords };
