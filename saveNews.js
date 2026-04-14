// saveNews.js — 뉴스 저장/조회 (Supabase saved_news 테이블)
const { supabase } = require('./supabase');

/**
 * 뉴스 저장
 * @param {string} userId
 * @param {string} newsId
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function saveNews(userId, newsId) {
  const { data: existing, error: selectError } = await supabase
    .from('saved_news')
    .select('news_id')
    .eq('user_id', userId)
    .eq('news_id', newsId)
    .maybeSingle();

  if (selectError) throw new Error('Supabase 조회 오류: ' + selectError.message);
  if (existing) return { success: false, message: '이미 저장됨' };

  const { error: insertError } = await supabase
    .from('saved_news')
    .insert({ user_id: userId, news_id: newsId, saved_at: new Date().toISOString() });

  if (insertError) throw new Error('Supabase 저장 오류: ' + insertError.message);
  return { success: true, message: '저장됨' };
}

/**
 * 유저의 저장 목록 조회
 * @param {string} userId
 * @returns {Promise<Array<{ newsId: string, savedAt: string }>>}
 */
async function getSavedNews(userId) {
  const { data, error } = await supabase
    .from('saved_news')
    .select('news_id, saved_at')
    .eq('user_id', userId)
    .order('saved_at', { ascending: false });

  if (error) throw new Error('Supabase 조회 오류: ' + error.message);
  return (data || []).map(r => ({ newsId: r.news_id, savedAt: r.saved_at }));
}

module.exports = { saveNews, getSavedNews };
