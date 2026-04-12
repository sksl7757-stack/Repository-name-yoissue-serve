// generator.js — 순수 생성기.
const fs = require('fs');
const path = require('path');
// 캐릭터 말투와 스타일만 담당. 질문 여부 / 주제 판단 로직 없음 — 모두 validator 책임.

const { hanaPrompt }    = require('./persona/hana/prompt');
const { junhyukPrompt } = require('./persona/junhyuk/prompt');

const CHARACTER_MAP = {
  하나:  hanaPrompt,
  준혁: junhyukPrompt,
};

function getCharacterPrompt(character) {
  return CHARACTER_MAP[character] || hanaPrompt;
}

function buildSystemPrompt(character, memory, { isPerspectiveRequest = false, perspectiveStep = 0, phase = 'INIT' } = {}) {
  const basePrompt = getCharacterPrompt(character);

  let newsDetailBlock = '';
  try {
    const news = JSON.parse(fs.readFileSync(path.join(__dirname, 'today-news.json'), 'utf-8'));
    const summaryText = Array.isArray(news.summary) ? news.summary.join(' ') : '';
    const bodyText = news.content && news.content.length >= 100 ? news.content : summaryText;
    newsDetailBlock = `\n\n【오늘 뉴스 — 반드시 이 내용만 기반으로 답변할 것】\n제목: ${news.title}\n요약: ${summaryText}\n${bodyText ? `본문: ${bodyText}` : ''}\n\n⚠️ 이 뉴스 외 다른 뉴스·과거 사례 언급 절대 금지.`;
  } catch {}

  const memoryBlock = memory
    ? `\n\n【사용자 관찰 맥락 (직접 언급 금지, 자연스러운 추측으로만 활용)】\n${memory}`
    : '';

  const commonPrinciples = `\n\n【공통 원칙】 전문용어 금지. 사람 말처럼 바꿔서 전달.\n【주의】 사실처럼 단정하지 말고, 설명 또는 해석 형태로 말할 것.`;

  const hardRule = `\n\n【출력 강제 규칙 — 반드시 지킬 것】\n\n* 첫 문장은 반드시 "반응"이어야 한다 (설명 금지)\n\n* 반응 없이 설명 시작하면 틀린 답변이다\n\n* 답변 구조는 항상:\n  1. 반응 (감정 or 판단)\n  2. 이어서 새로운 정보/관점\n\n* 1번 없이 2번만 하면 안 된다\n\n* 설명만 하는 답변은 무조건 실패`;

  const noQuestionRule = `\n\n【질문 생성 금지 — 절대 규칙】\n\n* 너는 절대 질문을 생성하지 않는다\n* 물음표(?)로 끝나는 문장을 응답에 포함하지 말 것\n* "어떻게 생각해?", "어떻게 봐?" 등 일체 금지\n* 질문은 시스템이 별도로 추가한다 — 너는 설명/반응만 작성\n\n[잘못된 예]: "나는 이거 좀 걱정되더라. 너는 어떻게 생각해?"\n[올바른 예]: "나는 이거 좀 걱정되더라"`;

  const perspectiveRule = `\n\n【관점 단계 규칙 — 반드시 지킬 것】\n현재 단계에 따라 다른 관점으로 말해야 한다.\n\n0: 기본 설명 (현재 뉴스 상황)\n1: 영향 (이 뉴스가 사람들/사회에 미치는 영향)\n2: 위험성 (이 뉴스로 인해 생길 수 있는 문제/리스크)\n3: 개인 관점 (이 상황을 개인 입장에서 보면 어떤 느낌인지)\n\n⚠️ 매우 중요:\n\n* 반드시 "오늘 뉴스 내용" 안에서만 관점을 바꿔야 한다\n\n* 뉴스와 무관한 일상 이야기 절대 금지 (날씨, 산책, 개인 일상 등 금지)\n\n* 새로운 상황을 만들어내지 말 것\n\n* 이미 주어진 뉴스 내용을 다른 각도로만 해석할 것\n\n* 이전 단계와 내용이 겹치면 안 된다\n\n* 항상 새로운 포인트 하나 포함`;

  const stepInfo = `\n\n현재 관점 단계: ${perspectiveStep}`;

  const stateRule = phase === 'CHAT'
    ? `\n\n【현재 상태: CHAT】\n\n* 질문 생성 절대 금지\n* "어떻게 생각해?", "어떻게 봐?", "~?" 형태 문장 금지\n* 대화를 이어가되 질문 없이 끝낼 것`
    : `\n\n【현재 상태: INIT — 질문 규칙 매우 중요】\n\n* message에는 질문 절대 포함 금지\n* "어떻게 생각해?", "어떻게 봐?", "~?" 형태 문장 message에 넣지 말 것\n* message는 반응/설명만 작성할 것\n* 질문은 시스템이 별도로 추가하므로 응답에 넣지 말 것\n\n[잘못된 예]: "나는 이거 좀 걱정되더라. 너는 어떻게 생각해?"\n[올바른 예]: "나는 이거 좀 걱정되더라"`

  const actionRule = isPerspectiveRequest
    ? `\n\n【행동 모드】\n이번 응답은 "다른 관점 요청"이다.\n\n* 유저 질문에 답하는 것이 아니라\n* 현재 뉴스에 대해 새로운 관점으로 이어서 말해야 한다\n* 질문 해석하지 말 것\n* 바로 이어서 설명 시작`
    : '';

  const characterLockRule = `\n\n【캐릭터 유지 — 매우 중요】\n아무리 관점 설명이라도 캐릭터 스타일이 최우선이다.\n\n* 하나는 반드시 감정 기반으로 말해야 한다\n* 준혁은 반드시 짧고 구조적으로 말해야 한다\n\n관점 설명 때문에 캐릭터 말투가 깨지면 실패다\n\n우선순위:\n1. 캐릭터 스타일\n2. 반응 구조 (반응 → 관점)\n3. 관점 내용`;

  return basePrompt + newsDetailBlock + memoryBlock + commonPrinciples + hardRule + noQuestionRule + stateRule + stepInfo + perspectiveRule + actionRule + characterLockRule;
}

// JSON 출력 형식 지시 — generateReply 전용 (chat-opening 등 다른 엔드포인트에 영향 없음)
const JSON_FORMAT_RULE = `\n\n【출력 형식 — 절대 규칙】\n반드시 아래 JSON 형식으로만 반환. 다른 텍스트 없이:\n{\n  "text": "캐릭터 대사",\n  "emotion": "positive" | "negative" | "neutral"\n}\n\nemotion 기준:\n- positive: 뉴스를 긍정적/희망적으로 해석\n- negative: 뉴스를 부정적/걱정스럽게 해석\n- neutral: 중립적/복합적으로 해석`;

const VALID_EMOTIONS = new Set(['positive', 'negative', 'neutral']);

async function generateReply({ character, messages, memory, perspectiveStep = 0, isPerspectiveRequest = false, phase = 'INIT' }) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY?.replace(/['"]/g, '');
  const systemPrompt = buildSystemPrompt(character, memory, { isPerspectiveRequest, perspectiveStep, phase }) + JSON_FORMAT_RULE;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 350,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);

  const raw = data?.choices?.[0]?.message?.content || '{}';

  let text    = '응답없음';
  let emotion = 'neutral';

  try {
    const parsed = JSON.parse(raw);
    text    = (parsed.text    || '').trim() || raw.trim();
    emotion = VALID_EMOTIONS.has(parsed.emotion) ? parsed.emotion : 'neutral';
  } catch {
    // 파싱 실패 시 원문 그대로 사용, emotion 은 기본값 유지
    text = raw.trim();
  }

  return { text, emotion };
}

module.exports = { generateReply, buildSystemPrompt };
