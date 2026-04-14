// stateManager.js — phase를 questionAsked 기반으로 코드에서만 결정.
// LLM은 phase 판단에 관여하지 않음.
const PHASE = { INIT: 'INIT', CHAT: 'CHAT' };

/**
 * messages 배열에서 questionAsked / perspectiveStep을 파생하고 phase를 결정.
 *
 * questionAsked = false → INIT
 * questionAsked = true  → CHAT
 * perspectiveStep: 클라이언트가 body로 넘겨준 값 사용 (기본 0)
 *
 * @param {Array} messages - [{role, content}, ...]
 * @param {number} perspectiveStep
 * @returns {{ phase: 'INIT'|'CHAT', questionAsked: boolean, perspectiveStep: number }}
 */
function getState(messages = [], perspectiveStep = 0) {
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  // includes('?') 대신 끝이 ?인지 확인 — URL·이모지 설명의 ? 오판 방지
  const questionAsked = assistantMessages.some(m => m.content && /\?\s*$/.test(m.content.trim()));
  const phase = questionAsked ? PHASE.CHAT : PHASE.INIT;
  return { phase, questionAsked, perspectiveStep };
}

/**
 * validator 이후 state 업데이트.
 *
 * @param {{ phase: string, questionAsked: boolean, perspectiveStep: number }} _currentState
 * @param {{ questionAsked: boolean }} update
 * @returns {{ phase: string, questionAsked: boolean, perspectiveStep: number }}
 */
function updateState(_currentState, { questionAsked }) {
  const phase = questionAsked ? PHASE.CHAT : PHASE.INIT;
  return { phase, questionAsked, perspectiveStep: _currentState.perspectiveStep };
}

module.exports = { getState, updateState, PHASE };
