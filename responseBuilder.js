// responseBuilder.js — 최종 JSON 응답 구조 생성

function stripQuestionSentences(text) {
  const cleaned = text
    .replace(/[^.!?\n]*\?[^\n]*/g, '')  // ? 포함 문장 제거
    .replace(/\n{2,}/g, '\n')
    .trim();
  return cleaned || text.trim();
}

/**
 * @param {{ message: string, question: string|null, phase?: string, emotion?: string }}
 * @returns {{ message: string, question: string|null, emotion: string }}
 */
function buildResponse({ message, question, phase, emotion = 'neutral' }) {
  const cleanMessage = stripQuestionSentences(message);
  if (phase === 'CHAT') return { message: cleanMessage, question: null, emotion };
  return { message: cleanMessage, question: question || null, emotion };
}

module.exports = { buildResponse };
