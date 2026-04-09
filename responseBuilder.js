// responseBuilder.js — 최종 JSON 응답 구조 생성
/**
 * @param {{ message: string, question: string|null, phase?: string }}
 * @returns {{ message: string, question: string|null }}
 */
function buildResponse({ message, question, phase }) {
  if (phase === 'CHAT') return { message, question: null };
  return { message, question: question || null };
}

module.exports = { buildResponse };
