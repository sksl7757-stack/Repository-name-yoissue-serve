// responseBuilder.js — 최종 JSON 응답 구조 생성

function stripQuestionSentences(text) {
  const cleaned = text
    .replace(/[^.!?\n]*\?[^\n]*/g, '')  // ? 포함 문장 제거
    .replace(/\n{2,}/g, '\n')
    .trim();
  return cleaned || text.trim();
}

/**
 * @param {{ message: string, question: string|null, phase?: string }}
 * @returns {{ message: string, question: string|null }}
 */
function buildResponse({ message, question, phase }) {
  const cleanMessage = stripQuestionSentences(message);
  if (phase === 'CHAT') return { message: cleanMessage, question: null };
  return { message: cleanMessage, question: question || null };
}

module.exports = { buildResponse };
