// records.js — 기록 저장/조회 (파일 기반)
// ⚠️ Vercel 서버리스 환경에서 /tmp는 요청 간 유지되지 않음 (cold start마다 초기화).
// 영구 저장이 필요하면 Supabase records 테이블로 마이그레이션하세요.
const fs = require('fs');
const RECORDS_PATH = '/tmp/records.json';

function readAll() {
  try { return JSON.parse(fs.readFileSync(RECORDS_PATH, 'utf-8')); }
  catch { return {}; }
}

function writeAll(data) {
  try { fs.writeFileSync(RECORDS_PATH, JSON.stringify(data), 'utf-8'); } catch {}
}

/**
 * 기록 저장 — 같은 newsId는 1번만
 * @param {string} userId
 * @param {{ newsId, title, character, userChoice, createdAt }} record
 */
function addRecord(userId, record) {
  const data = readAll();
  if (!data[userId]) data[userId] = [];
  const already = data[userId].some(r => r.newsId === record.newsId);
  if (already) return { success: false, message: '이미 저장됨' };
  data[userId].push(record);
  writeAll(data);
  return { success: true };
}

/**
 * 유저의 기록 목록 조회 (최신순)
 */
function getRecords(userId) {
  const data = readAll();
  const list = data[userId] || [];
  return [...list].reverse();
}

module.exports = { addRecord, getRecords };
