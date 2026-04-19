'use strict';

const { supabase } = require('./supabase');

const MAX_HISTORY = 30;

async function loadHistory() {
  try {
    const { data, error } = await supabase
      .from('daily_news')
      .select('title, content, date')
      .order('date', { ascending: false })
      .limit(MAX_HISTORY);

    if (error) {
      console.warn('  [history] Supabase 조회 실패:', error.message);
      return [];
    }

    return (data || []).map(row => ({
      title:     row.title || '',
      content:   (row.content || '').slice(0, 500),
      timestamp: row.date,
    }));
  } catch (err) {
    console.warn('  [history] loadHistory 오류:', err.message);
    return [];
  }
}

function saveHistory(_history, _entry) {
  // daily_news upsert에서 이미 저장됨 — 별도 저장 불필요
}

module.exports = { loadHistory, saveHistory };
