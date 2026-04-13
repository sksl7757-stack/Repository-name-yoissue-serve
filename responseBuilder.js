// responseBuilder.js — 최종 JSON 응답 구조 생성

function stripQuestionSentences(text) {
  const cleaned = text
    .replace(/[^.!?\n]*\?[^\n]*/g, '')  // ? 포함 문장 제거
    .replace(/\n{2,}/g, '\n')
    .trim();
  return cleaned || text.trim();
}

// 라벨 기반 출력 제거 — GPT가 "반응:", "설명:" 등을 출력할 경우 후처리로 제거
function stripLabels(text) {
  return text
    .replace(/^(반응|설명|요약|분석|핵심|결론)\s*:\s*/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * @param {{ message: string, question: string|null, phase?: string, emotion?: string }}
 * @returns {{ message: string, question: string|null, emotion: string }}
 */
function buildResponse({ message, question, phase, emotion = 'neutral' }) {
  const cleanMessage = stripQuestionSentences(stripLabels(message));
  if (phase === 'CHAT') return { message: cleanMessage, question: null, emotion };
  return { message: cleanMessage, question: question || null, emotion };
}

module.exports = { buildResponse };
