// validator.js — 모든 규칙 통제. LLM 응답을 검증하고 강제로 수정.
// 질문 추가/제거, 주제 이탈 처리를 코드에서만 결정.
const { PHASE } = require('./stateManager');
const { TOPIC } = require('./topicFilter');

const OFF_TOPIC_REDIRECTS = {
  하나: '나는 오늘 뉴스 얘기만 할 수 있어 😊 이 주제로 다시 얘기해보자!',
  준혁: '오늘 뉴스 주제로만 대화 가능함. 다시 뉴스 얘기로 돌아가자.',
};

// 코드에서 고정한 질문 — LLM이 생성한 질문을 사용하지 않음
const FORCED_QUESTIONS = {
  하나: '너는 이거 어떻게 생각해?',
  준혁: '이 상황 어떻게 보냐?',
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
 * GPT 응답을 phase / topicStatus 기준으로 강제 수정.
 *
 * INIT  → LLM 질문 제거 후 코드 고정 질문 추가 (항상)
 * CHAT  → 질문 문장 무조건 제거
 * OFF_TOPIC → 뉴스 주제 복귀 안내 메시지 반환
 *
 * @param {{ reply: string, phase: string, topicStatus: string, character: string }}
 * @returns {string}
 */
function validate({ reply, phase, topicStatus, character }) {
  // 1. 주제 이탈 → 리디렉션 (LLM 응답 무시)
  if (topicStatus === TOPIC.OFF) {
    return OFF_TOPIC_REDIRECTS[character] || OFF_TOPIC_REDIRECTS['하나'];
  }

  // 2. INIT → 질문 강제 생성 (LLM 질문 제거 + 코드 고정 질문 추가)
  if (phase === PHASE.INIT) {
    const base = stripQuestions(reply);
    const question = FORCED_QUESTIONS[character] || FORCED_QUESTIONS['하나'];
    return base + ' ' + question;
  }

  // 3. CHAT → 질문 무조건 제거
  if (phase === PHASE.CHAT) {
    return stripQuestions(reply);
  }

  return reply;
}

module.exports = { validate };
