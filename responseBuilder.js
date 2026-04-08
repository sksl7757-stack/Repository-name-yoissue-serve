// responseBuilder.js — 최종 JSON 응답 구조 생성
/**
 * @param {{ reply: string }}
 * @returns {{ reply: string }}
 */
function buildResponse({ reply }) {
  return { reply };
}

module.exports = { buildResponse };
