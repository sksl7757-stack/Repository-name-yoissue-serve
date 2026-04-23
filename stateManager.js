// stateManager.js — phase를 questionAsked 기반으로 코드에서만 결정.
// LLM은 phase 판단에 관여하지 않음.
const PHASE = { INIT: 'INIT', CHAT: 'CHAT' };

/**
 * messages 배열에서 questionAsked 를 파생하고 phase 를 결정.
 *
 * questionAsked = false → INIT
 * questionAsked = true  → CHAT
 *
 * @param {Array} messages - [{role, content}, ...]
 * @returns {{ phase: 'INIT'|'CHAT', questionAsked: boolean }}
 */
function getState(messages = []) {
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  // includes('?') 대신 끝이 ?인지 확인 — URL·이모지 설명의 ? 오판 방지
  const questionAsked = assistantMessages.some(m => m.content && /\?\s*$/.test(m.content.trim()));
  const phase = questionAsked ? PHASE.CHAT : PHASE.INIT;
  return { phase, questionAsked };
}

/**
 * validator 이후 state 업데이트.
 *
 * @param {{ phase: string, questionAsked: boolean }} _currentState
 * @param {{ questionAsked: boolean }} update
 * @returns {{ phase: string, questionAsked: boolean }}
 */
function updateState(_currentState, { questionAsked }) {
  const phase = questionAsked ? PHASE.CHAT : PHASE.INIT;
  return { phase, questionAsked };
}

module.exports = { getState, updateState, PHASE };
