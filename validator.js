// validator.js — 응답 품질 제어. 질문 추가/제거, 주제 이탈 처리.
const { PHASE } = require('./stateManager');
const { TOPIC } = require('./topicFilter');

const OFF_TOPIC_REDIRECTS = {
  하나: '나는 오늘 뉴스 얘기만 할 수 있어 😊 이 주제로 다시 얘기해보자!',
  준혁: '오늘 뉴스 주제로만 대화 가능함. 다시 뉴스 얘기로 돌아가자.',
};

const QUESTION_SUFFIXES = {
  하나: '너는 이거 어떻게 생각해?',
  준혁: '이 상황 어떻게 보냐?',
};

/**
 * GPT 응답을 phase / topicStatus 기준으로 검증 및 수정.
 *
 * - OFF_TOPIC → 뉴스 주제 복귀 안내 메시지 반환
 * - INIT + 질문 없음 → 질문 문장 추가
 * - CHAT + 질문 이미 있었음 + 현재 응답에 질문 있음 → 질문 문장 제거
 *
 * @param {{ reply: string, phase: string, questionAsked: boolean, topicStatus: string, character: string }}
 * @returns {string}
 */
function validate({ reply, phase, questionAsked, topicStatus, character }) {
  // 1. 주제 이탈 처리
  if (topicStatus === TOPIC.OFF) {
    return OFF_TOPIC_REDIRECTS[character] || OFF_TOPIC_REDIRECTS['하나'];
  }

  // 2. INIT인데 질문 없으면 추가
  if (phase === PHASE.INIT && !reply.includes('?')) {
    const suffix = QUESTION_SUFFIXES[character] || QUESTION_SUFFIXES['하나'];
    return reply.trimEnd() + ' ' + suffix;
  }

  // 3. CHAT인데 질문이 이미 나왔고 현재 응답에도 질문이 있으면 제거
  if (phase === PHASE.CHAT && questionAsked && reply.includes('?')) {
    const sentences = reply.split('\n').flatMap(line =>
      line.split(/(?<=[.!?])\s+/)
    );
    const withoutQuestion = sentences.filter(s => !s.trim().endsWith('?'));
    if (withoutQuestion.length > 0) return withoutQuestion.join(' ').trim();
  }

  return reply;
}

module.exports = { validate };
