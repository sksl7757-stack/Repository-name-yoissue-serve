'use strict';

// 날짜 헬퍼 — 모든 저장/조회 키는 KST(Asia/Seoul, UTC+9, DST 없음) 기준으로 통일.
// Railway 서버는 UTC로 돌지만, 사용자와 크론이 KST 기준이므로 KST 날짜 키를 사용한다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstNow() {
  return new Date(Date.now() + KST_OFFSET_MS);
}

// YYYY-MM-DD (KST)
function todayKST() {
  return kstNow().toISOString().slice(0, 10);
}

// MM-DD (KST) — 추모일 매칭용
function mmddKST() {
  return kstNow().toISOString().slice(5, 10);
}

module.exports = { todayKST, mmddKST };
