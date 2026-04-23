// generator.js — 순수 생성기 orchestrator.
// 캐릭터 말투/스타일만 담당. 질문 여부 / 주제 판단 로직 없음 — 모두 validator 책임.
// 프롬프트 블록은 prompts/blocks.js, persona 로드는 prompts/persona.js.

const { getTodayNews }            = require('./supabase');
const { getPersona, basePromptFor } = require('./prompts/persona');
const {
  commonPrinciples,
  hardRule,
  noQuestionRule,
  deepenRule,
  characterLockRule,
  primaryDirectionRule,
  JSON_FORMAT_RULE,
  stanceContractRule,
  stateRuleFor,
  sessionStanceRuleFor,
  memoryBlockFor,
  newsDetailBlockFor,
  categoryFrameRuleFor,
  politicalSafetyRuleFor,
  newsPersonalRuleFor,
} = require('./prompts/blocks');

// ─── 모드 판정 ─────────────────────────────────────────────────────────────

const OPINION_PATTERNS = [
  /어떻게\s*생각/, /어떻게\s*봐/, /어떤\s*것\s*같/, /어떨\s*것\s*같/,
  /괜찮을까/, /어떡하지/, /어떨까/, /될까\?/,
  /영향\s*있/, /영향\s*줄/,
];

function isOpinionRequest(messages) {
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return false;
  const text = lastUser.content || '';
  return OPINION_PATTERNS.some(p => p.test(text));
}

// ─── 시스템 프롬프트 조립 (/chat 자유 채팅용 — 캐릭터 1명) ────────────────

async function buildSystemPrompt(character, memory, {
  phase            = 'INIT',
  messages         = [],
  stance           = null,
  isMourning       = false,
  isDeepen         = false,
} = {}) {
  const isOpinion = !isMourning && isOpinionRequest(messages);
  const mode = isMourning ? 'MOURNING' : (isOpinion ? 'OPINION' : 'CONVERSE');
  console.log('[mode]', mode, '| character:', character, '| hasStance:', !!stance);

  // 페르소나 base prompt (모드별 필드 선택)
  const persona = getPersona(character);
  const activeBasePrompt = basePromptFor(persona, { isMourning, isOpinion });

  // 뉴스 detail + 카테고리
  let newsDetailBlock = '';
  let newsCategory = null;
  try {
    const news = await getTodayNews();
    newsDetailBlock = newsDetailBlockFor(news);
    newsCategory = news?.category ?? null;
  } catch {}

  // 조건부 블록
  const sessionStanceRule   = sessionStanceRuleFor(stance, isMourning);
  const politicalSafetyRule = politicalSafetyRuleFor(isMourning);
  const categoryFrameRule   = categoryFrameRuleFor(newsCategory, isMourning);
  const memoryBlock         = memoryBlockFor(memory);
  const newsPersonalRule    = newsPersonalRuleFor(isMourning);

  // MOURNING 에서는 대다수 일반 규칙 스킵 (추모 톤 유지)
  const skipGeneral = isMourning;
  const activeHardRule         = skipGeneral ? '' : hardRule;
  const activeCharacterLock    = skipGeneral ? '' : characterLockRule;
  const activeCommonPrinciples = skipGeneral ? '' : commonPrinciples;
  const activeStateRule        = skipGeneral ? '' : stateRuleFor(phase);
  const activeDeepenRule       = (isDeepen && !isMourning) ? deepenRule : '';
  const activePrimaryDirection = isMourning ? '' : primaryDirectionRule;

  return [
    sessionStanceRule,
    politicalSafetyRule,
    categoryFrameRule,
    activePrimaryDirection,
    activeBasePrompt,
    newsDetailBlock,
    newsPersonalRule,
    memoryBlock,
    activeCommonPrinciples,
    activeHardRule,
    noQuestionRule,
    activeStateRule,
    activeDeepenRule,
    activeCharacterLock,
  ].filter(Boolean).join('');
}

// ─── 오프닝 페어 프롬프트 (/chat-init 일반 모드 — 두 캐릭터 동시) ──────────
// DB 에 저장된 stance 를 프롬프트에 주입. 1회 LLM 호출로 {hana, junhyuk} 생성.

async function buildOpeningPairPrompt({ memory, stance }) {
  const hanaPersona    = getPersona('하나');
  const junhyukPersona = getPersona('준혁');
  const hanaBase    = hanaPersona?.conversePrompt || '';
  const junhyukBase = junhyukPersona?.conversePrompt || '';

  let newsDetailBlock = '';
  let newsCategory = null;
  try {
    const news = await getTodayNews();
    newsDetailBlock = newsDetailBlockFor(news);
    newsCategory = news?.category ?? null;
  } catch {}

  const politicalSafetyRule = politicalSafetyRuleFor(false);
  const categoryFrameRule   = categoryFrameRuleFor(newsCategory, false);
  const memoryBlock         = memoryBlockFor(memory);
  const newsPersonalRule    = newsPersonalRuleFor(false);

  const hanaSide    = stance?.hana_side    || '';
  const junhyukSide = stance?.junhyuk_side || '';
  const axis        = stance?.axis         || '';

  const stanceBlock = `\n\n【이번 대화의 대립 구도 — 고정】\n축: "${axis}"\n- 하나 쪽: "${hanaSide}"\n- 준혁 쪽: "${junhyukSide}"\n\n각 캐릭터는 자기 쪽 시점으로만 끝까지 말한다. 상대 쪽 관점 섞기·전환 표현·중립 마무리 전부 금지.`;

  const personaBlock = `\n\n【하나 페르소나 — "hana" 필드 생성에 적용】\n${hanaBase}\n\n【준혁 페르소나 — "junhyuk" 필드 생성에 적용】\n${junhyukBase}`;

  const jsonFormat = `\n\n【출력 형식 — JSON 고정, 다른 텍스트 없이】\n{\n  "hana":    "하나의 발언 (하나 페르소나, 2~3문장, 하나 쪽 시점 고수)",\n  "junhyuk": "준혁의 발언 (준혁 페르소나, 1~2문장, 준혁 쪽 시점 고수)"\n}\n\n* 두 발언은 서로 대립하되, 각자 자기 쪽만 말할 것\n* 뉴스 요약·중계 금지. 첫 문장부터 자기 관점\n* 한 캐릭터가 양쪽 관점 섞지 말 것`;

  return [
    stanceContractRule,
    stanceBlock,
    politicalSafetyRule,
    categoryFrameRule,
    personaBlock,
    newsDetailBlock,
    newsPersonalRule,
    memoryBlock,
    commonPrinciples,
    hardRule,
    noQuestionRule,
    jsonFormat,
  ].filter(Boolean).join('');
}

// ─── OpenAI 호출 ──────────────────────────────────────────────────────────

const VALID_EMOTIONS = new Set(['positive', 'negative', 'neutral']);

const MAX_TOKENS_BY_CHAR = { '하나': 400, '준혁': 250 };
function maxTokensFor(character) {
  return MAX_TOKENS_BY_CHAR[character] ?? 350;
}

const STYLE_PARAMS = {
  temperature: 0.9,
  frequency_penalty: 0.3,
  presence_penalty: 0.2,
};

async function generateReply({ character, messages, memory, phase = 'INIT', stance = null, isMourning = false }) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY?.replace(/['"]/g, '');
  const systemPrompt = await buildSystemPrompt(character, memory, { phase, messages, stance, isMourning }) + JSON_FORMAT_RULE;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.4-mini',
      max_tokens: maxTokensFor(character),
      ...STYLE_PARAMS,
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
    text = raw.trim();
  }

  return { text, emotion };
}

// 오프닝 페어 생성 — /chat-init 일반 모드. 1회 OpenAI 호출 → {hana, junhyuk}.
async function generateOpeningPair({ memory, stance }) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY?.replace(/['"]/g, '');
  const systemPrompt = await buildOpeningPairPrompt({ memory, stance });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.4-mini',
      max_tokens: 700,
      ...STYLE_PARAMS,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '오늘 뉴스에 대해 하나와 준혁이 각자 자기 쪽 시점으로 발언해줘. JSON 으로만.' },
      ],
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  const raw = data?.choices?.[0]?.message?.content || '{}';
  const parsed = JSON.parse(raw);
  return {
    hana:    String(parsed.hana    || '').trim(),
    junhyuk: String(parsed.junhyuk || '').trim(),
  };
}

async function generateReplyStream(systemPrompt, messages, character = null) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY?.replace(/['"]/g, '');
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.4-mini',
      max_tokens: maxTokensFor(character),
      ...STYLE_PARAMS,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt + '\n\n캐릭터 대화문만 출력해. JSON 형식 불필요.' },
        ...messages,
      ],
    }),
  });
  return response.body;
}

async function* parseOpenAIStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === '[DONE]') return;
      try { yield JSON.parse(jsonStr); } catch {}
    }
  }
}

module.exports = { generateReply, generateOpeningPair, generateReplyStream, parseOpenAIStream, buildSystemPrompt, buildOpeningPairPrompt, isOpinionRequest };
