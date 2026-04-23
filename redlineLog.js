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

// auto_log 본문에서 요약 수치 추출 — 목록 페이지 집계용.
// buildAutoLog 가 생성하는 고정 포맷("- 수집: N건" 등) 에 의존.
function parseCounts(autoLog) {
  const pick = (re) => {
    const m = (autoLog || '').match(re);
    return m ? parseInt(m[1], 10) : 0;
  };
  return {
    collectedCount: pick(/^- 수집:\s*(\d+)건/m),
    blockedCount:   pick(/^- 차단:\s*(\d+)건/m),
    passedCount:    pick(/^- 통과:\s*(\d+)건/m),
  };
}

// 플레이스홀더(게이트 거부·미선정 등) 판별 — '_(...)_' 로 시작하면 진짜 선정이 아님.
function isPlaceholderTitle(t) {
  return !t || t.startsWith('_(');
}

// auto_log + final_title + user_notes + final_meta 를 하나의 마크다운으로 합침.
// API `/redline-log/:date` 와 다운로드에서 재사용.
//
// final_title 이 실제 선정값일 때 2가지 가공 추가:
//   1) "## 요약" 직전에 "📰 오늘 최종 선정" 스포트라이트 섹션 삽입.
//      final_meta 가 있으면 제목을 URL 하이퍼링크로, 출처/카테고리/원문 보기 링크도 포함.
//   2) "## ✅ 통과" 목록에서 해당 제목 라인에 ⭐ 표시 + URL 링크로 변환.
function mergeLog({ auto_log, user_notes, final_title, final_meta }) {
  let body = (auto_log || '').split(FINAL_TITLE_MARKER).join(final_title || FINAL_TITLE_PLACEHOLDER);

  if (!isPlaceholderTitle(final_title)) {
    const meta = final_meta || {};
    const url  = meta.url || '';
    const host = url ? hostnameOf(url) : '';

    // (1) 스포트라이트 섹션.
    const spotlight = [];
    spotlight.push('## 📰 오늘 최종 선정');
    spotlight.push('');
    spotlight.push(url ? `### [${final_title}](${url})` : `### ${final_title}`);
    spotlight.push('');
    if (host)          spotlight.push(`- **출처**: ${host}`);
    if (meta.category) spotlight.push(`- **카테고리**: ${meta.category}`);
    if (meta.easy_title && meta.easy_title !== final_title) {
      spotlight.push(`- **쉬운 제목**: ${meta.easy_title}`);
    }
    if (url)           spotlight.push('');
    if (url)           spotlight.push(`[🔗 원문 보기 →](${url})`);
    spotlight.push('');

    // 오늘의 대립 구도 — stance-news 가 GPT 1회 호출로 생성.
    const stance = meta.stance;
    if (meta.is_mourning_required) {
      spotlight.push('## 🕯️ 대립 구도');
      spotlight.push('');
      spotlight.push('_추모 뉴스 — 대립 구도 생성 생략 (추모 모드는 양 캐릭터 공통 톤)._');
      spotlight.push('');
    } else if (stance && stance.axis) {
      spotlight.push('## 🎭 오늘의 대립 구도');
      spotlight.push('');
      spotlight.push(`**축**: ${stance.axis}`);
      spotlight.push('');
      spotlight.push(`- 🌸 **하나 쪽**: ${stance.hana_side || '(미설정)'}`);
      spotlight.push(`- ⚡ **준혁 쪽**: ${stance.junhyuk_side || '(미설정)'}`);
      spotlight.push('');
      spotlight.push('### 📐 선정 기준');
      spotlight.push('');
      spotlight.push('- 두 캐릭터(하나·준혁)가 자연스럽게 티격태격할 수 있는 대립축을 선택');
      spotlight.push('- 각 캐릭터는 자신의 페르소나 성격(하나: 감성·공감, 준혁: 냉철·분석)을 유지하며 대립');
      spotlight.push('- 정치 논쟁·이념 대립·인물 평가는 회피');
      spotlight.push('- 축·각 쪽 설명 모두 한 줄 이내로 간결하게');
      spotlight.push('');
      spotlight.push('_생성: `stance-news.js` (GPT 1회 호출, KST 07:30 크론)._');
      spotlight.push('');
    } else {
      spotlight.push('## 🎭 오늘의 대립 구도');
      spotlight.push('');
      spotlight.push('_아직 생성되지 않음. `node stance-news.js` 수동 실행 또는 KST 07:30 크론 대기 필요._');
      spotlight.push('');
    }

    spotlight.push('---');
    spotlight.push('');
    spotlight.push('');

    const summaryIdx = body.indexOf('## 요약');
    if (summaryIdx !== -1) {
      body = body.slice(0, summaryIdx) + spotlight.join('\n') + body.slice(summaryIdx);
    }

    // (2) 통과 목록 마킹 — 첫 occurrence 만 (dedupe 후라 안전).
    const titleLine = `- **${final_title}**`;
    const starLine  = url
      ? `- ⭐ **[${final_title}](${url})** _← 최종 선정_`
      : `- ⭐ **${final_title}** _← 최종 선정_`;
    body = body.replace(titleLine, starLine);
  }

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

// 목록 페이지용 — 전체 row 를 date 역순으로. auto_log 는 건수 추출 후 버린다.
async function listLogs() {
  const { data, error } = await supabase
    .from('redline_logs')
    .select('date, auto_log, final_title, updated_at')
    .order('date', { ascending: false });
  if (error) throw new Error(`redline_logs 목록 조회 실패: ${error.message}`);
  return (data || []).map(row => ({
    date:        row.date,
    final_title: row.final_title,
    updated_at:  row.updated_at,
    ...parseCounts(row.auto_log),
  }));
}

// 뷰어 이전/다음 네비게이션 — date 기준 앞뒤 가장 가까운 날짜.
async function getAdjacentDates(date) {
  const [prevRes, nextRes] = await Promise.all([
    supabase.from('redline_logs').select('date').lt('date', date).order('date', { ascending: false }).limit(1),
    supabase.from('redline_logs').select('date').gt('date', date).order('date', { ascending: true  }).limit(1),
  ]);
  if (prevRes.error) throw new Error(`redline_logs prev 조회 실패: ${prevRes.error.message}`);
  if (nextRes.error) throw new Error(`redline_logs next 조회 실패: ${nextRes.error.message}`);
  return {
    prev: prevRes.data && prevRes.data[0] ? prevRes.data[0].date : null,
    next: nextRes.data && nextRes.data[0] ? nextRes.data[0].date : null,
  };
}

// 뷰어에서 스포트라이트 섹션을 풍부하게 만들기 위해 daily_news 에서 URL/카테고리/출처를
// 끌어온다. daily_news row 가 없으면(게이트 거부·수동 삭제) null 반환 → mergeLog 는
// 기존처럼 title 만 표시.
async function getDailyNewsMeta(date) {
  const { data, error } = await supabase
    .from('daily_news')
    .select('title, url, category, source, stance, easy_title, is_mourning_required')
    .eq('date', date)
    .maybeSingle();
  if (error) throw new Error(`daily_news 메타 조회 실패: ${error.message}`);
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
  parseCounts,
  saveAutoLog,
  updateFinalSelection,
  getLog,
  saveUserNotes,
  listLogs,
  getAdjacentDates,
  getDailyNewsMeta,
  DEFAULT_USER_NOTES,
  FINAL_TITLE_PLACEHOLDER,
  FINAL_TITLE_MARKER,
};
