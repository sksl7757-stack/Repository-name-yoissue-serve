// validator.js — 모든 규칙 통제. LLM 응답을 검증하고 강제로 수정.
// 질문 추가/제거를 코드에서만 결정. 오프토픽 처리는 GPT 프롬프트 담당.
const { PHASE } = require('./stateManager');

// 코드에서 고정한 질문 — LLM이 생성한 질문을 사용하지 않음
// 두 캐릭터의 대립 구도를 명확히 해서 퀵리플라이 선택으로 자연스럽게 연결
const FORCED_QUESTIONS = {
  하나: '준혁이랑 나랑 생각이 좀 다른데, 너는 어느 쪽이야?',
  준혁: '하나랑 나 입장이 다른데. 넌 어느 쪽으로 봐?',
};

/**
 * '?'로 끝나는 문장을 모두 제거하고 남은 텍스트 반환.
 * 빈 결과가 되면 원본 반환(안전장치).
 */
function stripQuestions(text) {
  const lines = text.split('\n');
  const cleaned = lines
    .map(line => {
      const sentences = line.split(/(?<=[.!?])\s+/);
      return sentences.filter(s => !s.trim().endsWith('?')).join(' ').trim();
    })
    .filter(l => l.length > 0);
  return cleaned.length > 0 ? cleaned.join('\n').trim() : text.trim();
}

/**
 * GPT 응답을 phase 기준으로 강제 수정.
 *
 * INIT → LLM 질문 제거 후 코드 고정 질문을 별도 필드로 반환
 * CHAT → 질문 문장 무조건 제거, question = null
 *
 * @param {{ reply: string, phase: string, character: string }}
 * @returns {{ message: string, question: string|null }}
 */
function validate({ reply, phase, character }) {
  // INIT → 설명(message) + 고정 질문(question) 분리 반환
  if (phase === PHASE.INIT) {
    const message = stripQuestions(reply);
    const question = FORCED_QUESTIONS[character] || FORCED_QUESTIONS['하나'];
    return { message, question };
  }

  // CHAT → 질문 무조건 제거, question = null
  if (phase === PHASE.CHAT) {
    return { message: stripQuestions(reply), question: null };
  }

  return { message: reply, question: null };
}

module.exports = { validate };
