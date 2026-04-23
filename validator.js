// validator.js — LLM 응답에서 긴 질문 문장만 제거.
// 강제 질문 주입 없음. 질문은 오프닝 이후 새 3버튼(listen/opinion/question) 으로 유저가 주도.

/**
 * '?'로 끝나는 문장을 모두 제거하고 남은 텍스트 반환.
 * 빈 결과가 되면 원본 반환(안전장치).
 */
// 긴 질문(20자 초과 + '?' 끝)만 제거. 짧은 수사적 의문("무섭지 않아?", "느낌?")은 페르소나 말투라 보존.
function stripQuestions(text) {
  const lines = text.split('\n');
  const cleaned = lines
    .map(line => {
      const sentences = line.split(/(?<=[.!?])\s+/);
      return sentences
        .filter(s => {
          const t = s.trim();
          return !(t.endsWith('?') && t.length > 20);
        })
        .join(' ')
        .trim();
    })
    .filter(l => l.length > 0);
  return cleaned.length > 0 ? cleaned.join('\n').trim() : text.trim();
}

/**
 * GPT 응답에서 긴 질문만 제거.
 *
 * @param {{ reply: string }}
 * @returns {{ message: string }}
 */
function validate({ reply }) {
  return { message: stripQuestions(reply) };
}

module.exports = { validate };
