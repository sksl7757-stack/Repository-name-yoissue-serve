// services/persist.js — 대화 영구 저장 헬퍼. 임베딩 시스템 MVP.
// 모든 함수는 실패 시 console.error 후 null/undefined 반환. 채팅 흐름을 절대 막지 않음.

const { supabase } = require('../supabase');
const { CHARACTER_BY_NAME } = require('../characters');
const { todayKST } = require('../dateUtil');

function charNameToKey(name) {
  return CHARACTER_BY_NAME[name]?.id || null;
}

async function ensureUser(userId) {
  if (!userId) return false;
  const { error } = await supabase
    .from('users')
    .upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) { console.error('[persist] upsert users:', error.message); return false; }
  return true;
}

async function ensureConversation(userId, charKey) {
  if (!userId || !charKey) return null;
  const date_kst = todayKST();

  const { data: existing, error: selErr } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', userId).eq('char_key', charKey).eq('date_kst', date_kst)
    .maybeSingle();
  if (selErr) { console.error('[persist] select conversation:', selErr.message); return null; }
  if (existing) return existing.id;

  const { data: inserted, error: insErr } = await supabase
    .from('conversations')
    .insert({ user_id: userId, char_key: charKey, date_kst })
    .select('id')
    .single();
  if (!insErr) return inserted.id;

  // unique 위반(동시 insert) — 한 번 더 select 로 회수
  const { data: retry } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', userId).eq('char_key', charKey).eq('date_kst', date_kst)
    .maybeSingle();
  if (retry) return retry.id;
  console.error('[persist] insert conversation:', insErr.message);
  return null;
}

async function insertMessage({ conversationId, role, charKey, content }) {
  if (!conversationId || !content) return;
  const { error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, role, char_key: charKey, content });
  if (error) console.error('[persist] insert message:', error.message);
}

// fire-and-forget: 채팅 응답을 지연시키지 않음. 실패해도 swallow.
function persistAssistantTurn(conversationPromise, charName, content) {
  (async () => {
    try {
      const conversationId = await conversationPromise;
      if (!conversationId) return;
      await insertMessage({
        conversationId,
        role:    'assistant',
        charKey: charNameToKey(charName),
        content,
      });
    } catch (e) {
      console.error('[persist] assistant turn 실패:', e.message);
    }
  })();
}

module.exports = {
  charNameToKey,
  ensureUser,
  ensureConversation,
  insertMessage,
  persistAssistantTurn,
};
