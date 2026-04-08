// responseBuilder.js — 최종 JSON 응답 구조 생성
/**
 * @param {{ message: string, question: string|null }}
 * @returns {{ message: string, question: string|null }}
 */
function buildResponse({ message, question }) {
  return { message, question };
}

module.exports = { buildResponse };
