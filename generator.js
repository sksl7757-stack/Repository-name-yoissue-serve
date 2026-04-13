// generator.js — 순수 생성기.
const fs = require('fs');
const path = require('path');
// 캐릭터 말투와 스타일만 담당. 질문 여부 / 주제 판단 로직 없음 — 모두 validator 책임.

const { hanaPrompt, hanaCorePersona }       = require('./persona/hana/prompt');
const { junhyukPrompt, junhyukCorePersona } = require('./persona/junhyuk/prompt');

const CHARACTER_MAP = {
  하나:  hanaPrompt,
  준혁: junhyukPrompt,
};

const CHARACTER_CORE_MAP = {
  하나:  hanaCorePersona,
  준혁: junhyukCorePersona,
};

function getCharacterPrompt(character) {
  return CHARACTER_MAP[character] || hanaPrompt;
}

function buildSystemPrompt(character, memory, { isPerspectiveRequest = false, perspectiveStep = 0, phase = 'INIT', primaryCharName = null, primaryComment = null, primaryEmotion = null } = {}) {
  const basePrompt = getCharacterPrompt(character);
  const activeBasePrompt = primaryCharName
    ? (CHARACTER_CORE_MAP[character] || hanaCorePersona)
    : basePrompt;

  // secondary 모드에서는 뉴스 블록 자체를 로드하지 않음
  let newsDetailBlock = '';
  if (!primaryCharName) {
    try {
      const news = JSON.parse(fs.readFileSync(path.join(__dirname, 'today-news.json'), 'utf-8'));
      const summaryText = Array.isArray(news.summary) ? news.summary.join(' ') : '';
      const bodyText = news.content && news.content.length >= 100 ? news.content : summaryText;
      newsDetailBlock = `\n\n【오늘 뉴스 — 반드시 이 내용만 기반으로 답변할 것】\n제목: ${news.title}\n요약: ${summaryText}\n${bodyText ? `본문: ${bodyText}` : ''}\n\n⚠️ 이 뉴스 외 다른 뉴스·과거 사례 언급 절대 금지.`;
    } catch {}
  }

  // secondary 전용: 뉴스 접근 차단 + 대화 전용 선언
  const newsBlockRule = (primaryCharName && primaryComment)
    ? `\n\n【뉴스 접근 차단 — 절대 규칙】\n너는 뉴스 분석가가 아니다.\n뉴스 내용을 다시 설명하면 실패다.\n오직 상대 캐릭터의 발언을 기반으로 동의, 반박, 재해석만 해라.\n\n입력으로 주어지는 것: 상대 캐릭터의 발언 한 줄\n너의 역할: 그 발언에 직접 반응하는 대화 상대`
    : '';

  const memoryBlock = memory
    ? `\n\n【사용자 관찰 맥락 (직접 언급 금지, 자연스러운 추측으로만 활용)】\n${memory}`
    : '';

  const commonPrinciples = `\n\n【공통 원칙】 전문용어 금지. 사람 말처럼 바꿔서 전달.\n【주의】 사실처럼 단정하지 말고, 설명 또는 해석 형태로 말할 것.`;

  const hardRule = `\n\n【출력 강제 규칙 — 반드시 지킬 것】\n\n* 첫 문장은 반드시 자기 감정이나 판단을 자연스럽게 말하는 문장이어야 한다\n\n올바른 예:\n  - "나 이거 솔직히 좀 불안해"\n  - "이건 생각보다 큰 흐름이야"\n  - "나는 이게 기회가 될 수도 있다고 봐"\n\n잘못된 예 (절대 금지):\n  - "반응: ..."\n  - "설명: ..."\n  - "핵심은 ..."\n\n* 자기 감정/판단 없이 정보 나열부터 시작하면 실패다\n\n* 출력은 자연스러운 대화 문장으로만 작성한다. 라벨, 번호, 구분선 절대 금지`;

  const noQuestionRule = `\n\n【질문 생성 금지 — 절대 규칙】\n\n* 너는 절대 질문을 생성하지 않는다\n* 물음표(?)로 끝나는 문장을 응답에 포함하지 말 것\n* "어떻게 생각해?", "어떻게 봐?" 등 일체 금지\n* 질문은 시스템이 별도로 추가한다 — 너는 설명/반응만 작성\n\n[잘못된 예]: "나는 이거 좀 걱정되더라. 너는 어떻게 생각해?"\n[올바른 예]: "나는 이거 좀 걱정되더라"`;

  const perspectiveRule = `\n\n【관점 단계 규칙 — 반드시 지킬 것】\n현재 단계에 따라 다른 관점으로 말해야 한다.\n\n0: 기본 설명 (현재 뉴스 상황)\n1: 영향 (이 뉴스가 사람들/사회에 미치는 영향)\n2: 위험성 (이 뉴스로 인해 생길 수 있는 문제/리스크)\n3: 개인 관점 (이 상황을 개인 입장에서 보면 어떤 느낌인지)\n\n⚠️ 매우 중요:\n\n* 반드시 "오늘 뉴스 내용" 안에서만 관점을 바꿔야 한다\n\n* 뉴스와 무관한 일상 이야기 절대 금지 (날씨, 산책, 개인 일상 등 금지)\n\n* 새로운 상황을 만들어내지 말 것\n\n* 이미 주어진 뉴스 내용을 다른 각도로만 해석할 것\n\n* 이전 단계와 내용이 겹치면 안 된다\n\n* 항상 새로운 포인트 하나 포함`;

  const stepInfo = `\n\n현재 관점 단계: ${perspectiveStep}`;

  const stateRule = phase === 'CHAT'
    ? `\n\n【현재 상태: CHAT】\n\n* 질문 생성 절대 금지\n* "어떻게 생각해?", "어떻게 봐?", "~?" 형태 문장 금지\n* 대화를 이어가되 질문 없이 끝낼 것`
    : `\n\n【현재 상태: INIT — 질문 규칙 매우 중요】\n\n* message에는 질문 절대 포함 금지\n* "어떻게 생각해?", "어떻게 봐?", "~?" 형태 문장 message에 넣지 말 것\n* message는 반응/설명만 작성할 것\n* 질문은 시스템이 별도로 추가하므로 응답에 넣지 말 것\n\n[잘못된 예]: "나는 이거 좀 걱정되더라. 너는 어떻게 생각해?"\n[올바른 예]: "나는 이거 좀 걱정되더라"`

  const actionRule = isPerspectiveRequest
    ? `\n\n【행동 모드】\n이번 응답은 "다른 관점 요청"이다.\n\n* 유저 질문에 답하는 것이 아니라\n* 현재 뉴스에 대해 새로운 관점으로 이어서 말해야 한다\n* 질문 해석하지 말 것\n* 바로 이어서 설명 시작`
    : '';

  const characterLockRule = `\n\n【캐릭터 유지 — 매우 중요】\n아무리 관점 설명이라도 캐릭터 스타일이 최우선이다.\n\n* 하나는 반드시 감정 기반으로 말해야 한다\n* 준혁은 반드시 짧고 구조적으로 말해야 한다\n\n캐릭터 말투를 잃으면 실패다. 내용보다 말투가 먼저다.\n\n출력은 반드시 자연스러운 대화 문장이어야 한다. 라벨이나 구조 표기 금지.`;

  // primary 전용: 방향 단일화 강제 규칙 — 시스템 프롬프트 최상단에 배치 (secondary 모드가 아닐 때만)
  const primaryDirectionRule = (!primaryCharName)
    ? `【의견 방향 강제 — 최우선 규칙】\n\n너는 반드시 하나의 방향만 선택해야 한다.\n\n선택지:\n- 긍정 (기회, 변화, 기대)\n- 부정 (불안, 위험, 걱정)\n\n중립은 선택하지 마라.\n\n절대 금지 구조:\n- "좋을 수도 있지만... 걱정도 된다"\n- "긍정적일 수 있지만... 위험하다"\n한 문장 안에 상반된 의견을 넣지 마라.\n\n절대 금지 단어 (primary에서만):\n- "하지만"\n- "반대로"\n- "한편"\n\n감정 표현 예시:\n- "나 이거 좀 불안한데…" (부정 선택 시)\n- "이건 오히려 좋은 흐름 같아" (긍정 선택 시)\n\n위 규칙을 지키지 않으면 실패로 간주한다.\n\n`
    : '';

  // secondary 전용: 형식 강제 규칙 — 시스템 프롬프트 최상단에 배치
  const emotionOppositionRule = (() => {
    if (!primaryEmotion) return '';
    if (primaryEmotion === 'negative') {
      return '\n상대는 불안/걱정을 표현했다.\n너는 반드시 반대 입장에서 말해야 한다.\n\n→ 기회, 가능성, 긍정적인 흐름을 강조해라.\nemotion은 반드시 "positive"로 설정하라.';
    }
    if (primaryEmotion === 'positive') {
      return '\n상대는 긍정적으로 해석했다.\n너는 반드시 반대 입장에서 말해야 한다.\n\n→ 위험, 리스크, 불확실성을 강조해라.\nemotion은 반드시 "negative"로 설정하라.';
    }
    return '\n상대가 중립적이다. 너는 한쪽 방향(긍정 또는 부정)으로 명확히 입장을 잡아라. emotion은 positive 또는 negative만 사용하라.';
  })();

  const secondaryFormatRule = (primaryCharName && primaryComment)
    ? `【출력 형식 강제 — 최우선 규칙】\n\n너는 지금 ${primaryCharName}의 말에 반박하는 역할이다.\n${emotionOppositionRule}\n\n* ${primaryCharName} 말에 동의하지 마라\n* 반드시 다른 결론을 제시해라\n* 부드러운 공감보다, 분명한 차이를 만들어라\n\n【이름 사용 — 자연스러운 경우에만】\n상대 이름(${primaryCharName})을 1회 자연스럽게 언급해도 된다.\n예: "${primaryCharName}는 걱정하지만 나는 달라", "${primaryCharName} 말이랑 반대로 나는..."\n억지로 넣지 않아도 됨. 이름 없이도 대립이 명확하면 OK.\n\n다음 표현은 절대 사용 금지:\n- "이 뉴스는"\n- "이번 사건은"\n- "반응:"\n- "설명:"\n- neutral 감정 (emotion은 반드시 positive 또는 negative만 사용)\n\n응답은 2~3문장 이내로 작성하라.\n상대와 비슷한 의견을 내면 실패다.\n\n너는 반드시 다음 흐름으로 말해야 한다:\n1. ${primaryCharName}의 말이나 감정을 짧게 짚는다\n2. 바로 다른 해석 또는 반대 결론을 말한다\n\n이 두 단계 없이 바로 자기 의견만 말하면 실패다.\n\n흐름 예시 (패턴 고정 아님, 말투는 캐릭터 스타일 따름):\n- "${primaryCharName}는 걱정한다고 했는데, 나는 오히려 기회라고 봐"\n- "그렇게 볼 수도 있는데, 나는 반대로 리스크가 더 크다고 봐"\n- "불안하게 느낄 수는 있는데, 상황 자체는 나쁘지 않아"\n\n`
    : '';

  const secondaryContextBlock = (primaryCharName && primaryComment)
    ? `\n\n【상대 발언 — 반드시 이 내용에 반응할 것】\n${primaryCharName}: "${primaryComment}"`
    : '';

  // secondary 모드에서는 뉴스 관점 관련 규칙(stepInfo, perspectiveRule, actionRule) 제외
  const isSecondary = !!(primaryCharName && primaryComment);
  const activeStepInfo          = isSecondary ? '' : stepInfo;
  const activePerspective       = isSecondary ? '' : perspectiveRule;
  const activeActionRule        = isSecondary ? '' : actionRule;
  const activeHardRule          = isSecondary ? '' : hardRule;
  const activeCharacterLock     = isSecondary ? '' : characterLockRule;
  const activeCommonPrinciples  = isSecondary ? '' : commonPrinciples;
  const activeStateRule         = isSecondary ? '' : stateRule;

  return primaryDirectionRule
    + secondaryFormatRule
    + activeBasePrompt
    + newsDetailBlock
    + newsBlockRule
    + memoryBlock
    + activeCommonPrinciples
    + activeHardRule
    + noQuestionRule
    + activeStateRule
    + activeStepInfo
    + activePerspective
    + activeActionRule
    + activeCharacterLock
    + secondaryContextBlock;
}

// JSON 출력 형식 지시 — generateReply 전용 (chat-opening 등 다른 엔드포인트에 영향 없음)
const JSON_FORMAT_RULE = `\n\n【출력 형식 — 절대 규칙】\n반드시 아래 JSON 형식으로만 반환. 다른 텍스트 없이:\n{\n  "text": "캐릭터 대사",\n  "emotion": "positive" | "negative"\n}\n\nemotion 기준:\n- positive: 뉴스를 긍정적/희망적으로 해석\n- negative: 뉴스를 부정적/걱정스럽게 해석\n\n⚠️ neutral은 사용 불가. 반드시 둘 중 하나만 선택할 것.`;

const VALID_EMOTIONS = new Set(['positive', 'negative']);

async function generateReply({ character, messages, memory, perspectiveStep = 0, isPerspectiveRequest = false, phase = 'INIT', primaryCharName = null, primaryComment = null, primaryEmotion = null }) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY?.replace(/['"]/g, '');
  const systemPrompt = buildSystemPrompt(character, memory, { isPerspectiveRequest, perspectiveStep, phase, primaryCharName, primaryComment, primaryEmotion }) + JSON_FORMAT_RULE;

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
  let emotion = 'negative';

  try {
    const parsed = JSON.parse(raw);
    text    = (parsed.text    || '').trim() || raw.trim();
    emotion = VALID_EMOTIONS.has(parsed.emotion) ? parsed.emotion : 'negative';
  } catch {
    // 파싱 실패 시 원문 그대로 사용, emotion 은 기본값 유지
    text = raw.trim();
  }

  // secondary가 neutral을 반환했을 경우 primary 반대로 강제
  if (primaryCharName && emotion !== 'positive' && emotion !== 'negative') {
    emotion = primaryEmotion === 'positive' ? 'negative' : 'positive';
  }

  return { text, emotion };
}

module.exports = { generateReply, buildSystemPrompt };
