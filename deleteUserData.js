// deleteUserData.js — "내 데이터 삭제" 처리. GDPR/개인정보보호법 삭제권 대응.
//
// 인증 모델 주의: 현재 앱은 Supabase Auth 미도입. user_id 는 클라이언트가 AsyncStorage
// 에서 생성한 문자열(`user_${ts}_${rand}`). 호출자는 이미 검증된 "내" user_id 를
// 넘겨준다고 가정한다. Supabase Auth 전환 후에는 req.user.id 로 교체할 것.
//
// 삭제 전략:
// - Supabase JS 클라이언트는 다중 테이블 트랜잭션을 지원하지 않는다.
// - 순서: FK 가 없는 테이블(saved_news/records/push_tokens) 먼저 → memory_* → users
//   (users cascade 로 conversations/messages/memory_* 정리되지만, 감사 로그를 위해
//   memory_* 는 명시적으로도 지운다).
// - 실패 시 어떤 테이블이 성공/실패했는지 배열로 반환. 호출자가 재시도 가능.
// - users 행 삭제를 마지막에 두어 부분 실패 시에도 앵커(users 행)가 남아 재시도 가능.

const { supabase } = require('./supabase');

async function deleteFrom(table, filter) {
  const { error, count } = await supabase
    .from(table)
    .delete({ count: 'exact' })
    .match(filter);
  if (error) return { table, ok: false, error: error.message };
  return { table, ok: true, count: count ?? 0 };
}

/**
 * user_id 기준 데이터 전부 삭제.
 * @param {string} userId
 * @param {string|null} pushToken  선택. 주어지면 해당 토큰 레코드도 삭제.
 * @returns {Promise<{ success: boolean, deleted: string[], failed: Array<{table:string,error:string}>, counts: Record<string,number> }>}
 */
async function deleteUserData(userId, pushToken = null) {
  if (!userId || typeof userId !== 'string') {
    throw new Error('invalid user_id');
  }

  const results = [];

  // 1) FK 없는 유저 보유 데이터
  results.push(await deleteFrom('saved_news', { user_id: userId }));
  results.push(await deleteFrom('records',    { user_id: userId }));

  // 2) push_tokens — user_id 매치로 삭제(우선). pushToken 도 같이 오면 토큰 기준도
  //    보조 삭제(다른 디바이스의 동일 유저 토큰, 혹은 user_id 미기입 레거시 행 정리).
  //    두 호출 건수를 합산해 counts.push_tokens 하나로 반환.
  const tokenResults = [];
  tokenResults.push(await deleteFrom('push_tokens', { user_id: userId }));
  if (pushToken) {
    tokenResults.push(await deleteFrom('push_tokens', { token: pushToken }));
  }
  const tokenOk = tokenResults.every(r => r.ok);
  if (tokenOk) {
    const total = tokenResults.reduce((s, r) => s + (r.count || 0), 0);
    results.push({ table: 'push_tokens', ok: true, count: total });
  } else {
    const firstErr = tokenResults.find(r => !r.ok);
    results.push({ table: 'push_tokens', ok: false, error: firstErr.error });
  }

  // 3) 메모리(임베딩 MVP 스키마). users cascade 로도 지워지지만 감사 명시.
  results.push(await deleteFrom('memory_chunks',    { user_id: userId }));
  results.push(await deleteFrom('memory_summaries', { user_id: userId }));

  // 4) conversations → messages cascade. users cascade 안에 포함되지만 명시 삭제로 감사 남김.
  results.push(await deleteFrom('conversations', { user_id: userId }));

  // 5) 마지막으로 users 행. 남아있는 FK(혹여 빠진 경로)는 cascade 로 정리.
  results.push(await deleteFrom('users', { id: userId }));

  const deleted = results.filter(r => r.ok).map(r => r.table);
  const failed  = results.filter(r => !r.ok).map(r => ({ table: r.table, error: r.error }));
  const counts  = Object.fromEntries(results.filter(r => r.ok).map(r => [r.table, r.count]));

  return {
    success: failed.length === 0,
    deleted,
    failed,
    counts,
  };
}

module.exports = { deleteUserData };
