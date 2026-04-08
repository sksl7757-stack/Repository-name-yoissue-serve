// stateManager.js — phase를 questionAsked 기반으로 코드에서만 결정.
// LLM은 phase 판단에 관여하지 않음.
const PHASE = { INIT: 'INIT', CHAT: 'CHAT' };

/**
 * messages 배열에서 questionAsked를 파생하고 phase를 결정.
 *
 * questionAsked = false → INIT (아직 질문 없음 → 첫 대화)
 * questionAsked = true  → CHAT (질문이 한 번이라도 나왔음 → 이후 대화)
 *
 * @param {Array} messages - [{role, content}, ...]
 * @returns {{ phase: 'INIT'|'CHAT', questionAsked: boolean }}
 */
function getState(messages = []) {
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  const questionAsked = assistantMessages.some(m => m.content && m.content.includes('?'));
  const phase = questionAsked ? PHASE.CHAT : PHASE.INIT;
  return { phase, questionAsked };
}

/**
 * validator가 질문을 추가한 경우 state를 업데이트.
 * 반환된 state는 같은 요청 내에서만 사용 (다음 요청은 messages 기반으로 재파생).
 *
 * @param {{ phase: string, questionAsked: boolean }} currentState
 * @param {{ questionAsked: boolean }} update
 * @returns {{ phase: string, questionAsked: boolean }}
 */
function updateState(_currentState, { questionAsked }) {
  const phase = questionAsked ? PHASE.CHAT : PHASE.INIT;
  return { phase, questionAsked };
}

module.exports = { getState, updateState, PHASE };
