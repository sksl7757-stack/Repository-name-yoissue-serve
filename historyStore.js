'use strict';

// 선택된 뉴스 이력 저장 및 조회
// news-history.json 에 최근 30건을 보관

const fs   = require('fs');
const path = require('path');

const HISTORY_PATH = path.join('/tmp', 'news-history.json');
const MAX_HISTORY  = 30;

/**
 * 저장된 선택 이력을 불러온다
 * @returns {Array} [{ title, content, timestamp }, ...]
 */
function loadHistory() {
  try {
    if (!fs.existsSync(HISTORY_PATH)) return [];
    return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * 새 선택 결과를 이력에 추가하고 저장한다
 * @param {Array}  history  - loadHistory() 로 불러온 기존 이력
 * @param {object} entry    - { title, content, timestamp, eventId }
 */
function saveHistory(history, entry) {
  const updated = [entry, ...history].slice(0, MAX_HISTORY);
  try {
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(updated, null, 2), 'utf8');
  } catch (err) {
    console.error('history save failed:', err.message);
  }
}

module.exports = { loadHistory, saveHistory };
