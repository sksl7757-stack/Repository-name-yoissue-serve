// stateManager.js — 대화 phase와 question_asked 상태를 메시지 배열에서 파생
const PHASE = { INIT: 'INIT', CHAT: 'CHAT' };

/**
 * messages 배열을 분석해서 현재 phase와 질문 여부를 반환.
 * Vercel 서버리스 환경이므로 외부 저장소 없이 요청 데이터만으로 상태 파악.
 * @param {Array} messages - [{role, content}, ...]
 * @returns {{ phase: 'INIT'|'CHAT', questionAsked: boolean }}
 */
function getState(messages = []) {
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  const phase = assistantMessages.length === 0 ? PHASE.INIT : PHASE.CHAT;
  const questionAsked = assistantMessages.some(m => m.content && m.content.includes('?'));
  return { phase, questionAsked };
}

module.exports = { getState, PHASE };
