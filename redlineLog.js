'use strict';

// 일일 redline 로그 — Supabase `redline_logs` 테이블이 소스 오브 트루스.
//
// 컬럼 분리:
//   - auto_log    : cron 이 Stage 1 끝에 overwrite (차단/통과 자동 집계)
//   - user_notes  : 유저만 편집 (판단·메모·조정 사항). cron 이 절대 건드리지 않음.
//   - final_title : Stage 2 가 갱신 (pickBestNews 선정 결과)
//
// 순수 함수(buildAutoLog / mergeLog) 는 I/O 없음 — 추후 GitHub 자동 push / 옵시디언
// 동기화 등 exporter 모듈에서 그대로 재사용 가능.

const { supabase } = require('./supabase');
const { CATEGORY_LABELS, REDLINE_CATEGORIES } = require('./redline');

// 카테고리 표시 순서 — REDLINE_CATEGORIES 정의 순서.
const CATEGORY_ORDER = REDLINE_CATEGORIES.map(c => c.name);

const FINAL_TITLE_PLACEHOLDER = '_(Stage 2 완료 후 갱신)_';
const FINAL_TITLE_MARKER      = '{{FINAL_TITLE}}';

const DEFAULT_USER_NOTES = `## 📝 오늘의 조정 사항

- [ ]
- [ ]
- [ ]

## 📓 메모

`;

// ─── 순수 함수 (I/O 없음) ────────────────────────────────────────────────────

function hostnameOf(url) {
  if (!url) return '(unknown)';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '(unknown)';
  }
}

function dedupeByUrl(items) {
  const seen = new Set();
  return items.filter(it => {
    const key = it.url || it.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupBlocked(blocked) {
  const by = {};
  for (const b of blocked) {
    if (!by[b.category]) by[b.category] = [];
    by[b.category].push(b);
  }
  return by;
}

// cron 이 생성하는 자동 영역. 유저 편집 영역(판단/메모/조정사항) 은 포함하지 않음.
// 최종 선정은 {{FINAL_TITLE}} 마커로 두고 렌더 시 final_title 컬럼으로 치환.
function buildAutoLog({ date, collectedCount, blocked, passed }) {
  const dedupedBlocked = dedupeByUrl(blocked);
  const dedupedPassed  = dedupeByUrl(passed);
  const yyyyMm         = date.slice(0, 7);
  const grouped        = groupBlocked(dedupedBlocked);

  const lines = [];
  lines.push(`# ${date} 레드라인 로그`);
  lines.push('');
  lines.push(`#레드라인 #${yyyyMm}`);
  lines.push('');
  lines.push('## 요약');
  lines.push(`- 수집: ${collectedCount}건`);
  lines.push(`- 차단: ${dedupedBlocked.length}건`);
  lines.push(`- 통과: ${dedupedPassed.length}건`);
  lines.push(`- 최종 선정: ${FINAL_TITLE_MARKER}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  lines.push(`## 🚫 차단 (${dedupedBlocked.length}건)`);
  lines.push('');
  if (dedupedBlocked.length === 0) {
    lines.push('_차단된 뉴스 없음._');
    lines.push('');
  } else {
    for (const catName of CATEGORY_ORDER) {
      const items = grouped[catName];
      if (!items || items.length === 0) continue;
      const label = CATEGORY_LABELS[catName] || catName;
      lines.push(`### ${label} (${items.length}건)`);
      lines.push('');
      for (const it of items) {
        lines.push(`- **${it.title}**`);
        lines.push(`  - 매칭: \`${it.matched}\``);
        if (it.url) lines.push(`  - URL: ${it.url}`);
      }
      lines.push('');
    }
  }
  lines.push('---');
  lines.push('');

  lines.push(`## ✅ 통과 (${dedupedPassed.length}건)`);
  lines.push('');
  if (dedupedPassed.length === 0) {
    lines.push('_통과된 뉴스 없음._');
    lines.push('');
  } else {
    for (const it of dedupedPassed) {
      lines.push(`- **${it.title}**`);
      lines.push(`  - 출처: ${hostnameOf(it.url)}`);
      if (it.url) lines.push(`  - URL: ${it.url}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// auto_log + final_title + user_notes 를 하나의 마크다운으로 합침.
// API `/redline-log/:date` 와 다운로드에서 재사용.
function mergeLog({ auto_log, user_notes, final_title }) {
  const body  = (auto_log || '').split(FINAL_TITLE_MARKER).join(final_title || FINAL_TITLE_PLACEHOLDER);
  const notes = (user_notes || '').trim();
  if (!notes) return body;
  const sep = body.endsWith('\n') ? '' : '\n';
  return `${body}${sep}---\n\n${notes}\n`;
}

// ─── Supabase CRUD ───────────────────────────────────────────────────────────

// Stage 1 끝에 호출. auto_log 만 overwrite. user_notes / final_title 보존.
// row 가 없으면 생성하며 user_notes 기본 템플릿 삽입.
async function saveAutoLog(date, payload) {
  const autoLog = buildAutoLog({ date, ...payload });

  const { data: existing, error: selErr } = await supabase
    .from('redline_logs')
    .select('date')
    .eq('date', date)
    .maybeSingle();
  if (selErr) throw new Error(`redline_logs 조회 실패: ${selErr.message}`);

  if (existing) {
    const { error } = await supabase
      .from('redline_logs')
      .update({ auto_log: autoLog, updated_at: new Date().toISOString() })
      .eq('date', date);
    if (error) throw new Error(`redline_logs auto_log 갱신 실패: ${error.message}`);
  } else {
    const { error } = await supabase
      .from('redline_logs')
      .insert({
        date,
        auto_log:    autoLog,
        user_notes:  DEFAULT_USER_NOTES,
        final_title: null,
      });
    if (error) throw new Error(`redline_logs insert 실패: ${error.message}`);
  }
  return { date, length: autoLog.length };
}

// Stage 2 저장 성공 후 호출. final_title 컬럼만 UPDATE.
async function updateFinalSelection(date, title) {
  const { error } = await supabase
    .from('redline_logs')
    .update({ final_title: title, updated_at: new Date().toISOString() })
    .eq('date', date);
  if (error) {
    console.warn(`⚠️ redline_logs final_title 갱신 실패: ${error.message}`);
    return false;
  }
  return true;
}

async function getLog(date) {
  const { data, error } = await supabase
    .from('redline_logs')
    .select('date, auto_log, user_notes, final_title, updated_at')
    .eq('date', date)
    .maybeSingle();
  if (error) throw new Error(`redline_logs 조회 실패: ${error.message}`);
  return data;
}

async function saveUserNotes(date, userNotes) {
  // 빈 문자열은 허용, null/undefined 은 '' 로 표준화.
  const normalized = typeof userNotes === 'string' ? userNotes : '';
  const { error } = await supabase
    .from('redline_logs')
    .update({ user_notes: normalized, updated_at: new Date().toISOString() })
    .eq('date', date);
  if (error) throw new Error(`redline_logs user_notes 갱신 실패: ${error.message}`);
  return true;
}

module.exports = {
  buildAutoLog,
  mergeLog,
  saveAutoLog,
  updateFinalSelection,
  getLog,
  saveUserNotes,
  DEFAULT_USER_NOTES,
  FINAL_TITLE_PLACEHOLDER,
  FINAL_TITLE_MARKER,
};
