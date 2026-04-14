// saveNews.js — 뉴스 저장 기능 (파일 기반 간단 구현)
// ⚠️ Vercel 서버리스 환경에서 /tmp는 요청 간 유지되지 않음 (cold start마다 초기화).
// 영구 저장이 필요하면 Supabase saved_news 테이블로 마이그레이션하세요.
const fs = require('fs');
const SAVED_PATH = '/tmp/saved-news.json';

function readSaved() {
  try { return JSON.parse(fs.readFileSync(SAVED_PATH, 'utf-8')); }
  catch { return {}; }
}

function writeSaved(data) {
  try { fs.writeFileSync(SAVED_PATH, JSON.stringify(data), 'utf-8'); } catch {}
}

/**
 * 뉴스 저장
 * @returns {{ success: boolean, message: string }}
 */
function saveNews(userId, newsId) {
  const data = readSaved();
  if (!data[userId]) data[userId] = [];
  const already = data[userId].some(item => item.newsId === newsId);
  if (already) return { success: false, message: '이미 저장됨' };
  data[userId].push({ newsId, savedAt: Date.now() });
  writeSaved(data);
  return { success: true, message: '저장됨' };
}

/**
 * 유저의 저장 목록 조회
 * @returns {Array<{ newsId: string, savedAt: number }>}
 */
function getSavedNews(userId) {
  const data = readSaved();
  return data[userId] || [];
}

module.exports = { saveNews, getSavedNews };
