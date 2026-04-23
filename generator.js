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
  stateRuleFor,
  sessionStanceRuleFor,
  secondaryFormatRuleFor,
  newsBlockRuleFor,
  secondaryContextBlockFor,
  memoryBlockFor,
  newsDetailBlockFor,
  categoryFrameRuleFor,
  politicalSafetyRuleFor,
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

// ─── 시스템 프롬프트 조립 ─────────────────────────────────────────────────

async function buildSystemPrompt(character, memory, {
  phase                = 'INIT',
  primaryCharName      = null,
  primaryComment       = null,
  primaryEmotion       = null,
  messages             = [],
  characterEmotion     = null,
  isMourning           = false,
  isDeepen             = false,
} = {}) {
  console.log('[buildSystemPrompt] primaryCharName:', primaryCharName, '| has primaryComment:', !!primaryComment, '| isMourning:', isMourning);

  const isSecondary = !!(primaryCharName && primaryComment);
  const isOpinion   = !isSecondary && !isMourning && isOpinionRequest(messages);
  const mode = isMourning ? 'MOURNING' : (primaryCharName ? 'SECONDARY' : (isOpinion ? 'OPINION' : 'CONVERSE'));
  console.log('[mode]', mode, '| character:', character);

  // 페르소나 base prompt (모드별 필드 선택)
  const persona = getPersona(character);
  const activeBasePrompt = basePromptFor(persona, { isMourning, primaryCharName, isOpinion });

  // SECONDARY 도 뉴스 detail 을 받아야 주제 앵커가 유지됨 (재설명 금지는 newsBlockRule 에서 처리)
  // category 는 CATEGORIES(process-news.js) 의 한글 이름 그대로 저장됨 — 정치/경제/환경/건강/IT/문화/사회
  let newsDetailBlock = '';
  let newsCategory = null;
  try {
    const news = await getTodayNews();
    newsDetailBlock = newsDetailBlockFor(news);
    newsCategory = news?.category ?? null;
  } catch {}

  // 조건부 블록 — 빌더 내부에서 가드하므로 여기서는 그냥 호출
  const sessionStanceRule     = sessionStanceRuleFor(characterEmotion, isMourning, character, newsCategory);
  const politicalSafetyRule   = politicalSafetyRuleFor(isMourning);
  const categoryFrameRule     = categoryFrameRuleFor(newsCategory, isMourning);
  const secondaryFormatRule   = secondaryFormatRuleFor(primaryCharName, primaryComment, primaryEmotion);
  const secondaryContextBlock = secondaryContextBlockFor(primaryCharName, primaryComment);
  const newsBlockRule         = newsBlockRuleFor(primaryCharName, primaryComment);
  const memoryBlock           = memoryBlockFor(memory);

  // SECONDARY / MOURNING 에서는 대다수 일반 규칙 스킵
  const skipGeneral = isSecondary || isMourning;
  const activeHardRule         = skipGeneral ? '' : hardRule;
  const activeCharacterLock    = skipGeneral ? '' : characterLockRule;
  const activeCommonPrinciples = skipGeneral ? '' : commonPrinciples;
  const activeStateRule        = skipGeneral ? '' : stateRuleFor(phase);
  // 심화 블록은 MOURNING 에서는 스킵, SECONDARY 에서도 주입 (둘 다 심화 참여)
  const activeDeepenRule       = (isDeepen && !isMourning) ? deepenRule : '';

  // primaryDirectionRule 은 primary 모드 전용 상수 — SECONDARY 에서는 빈 문자열
  const activePrimaryDirection = (isMourning || primaryCharName) ? '' : primaryDirectionRule;
  const activeSecondaryFormat  = isMourning ? '' : secondaryFormatRule;
  const activeSecondaryContext = isMourning ? '' : secondaryContextBlock;

  console.log('[sessionStanceRule]', characterEmotion, '| length:', sessionStanceRule.length);
  if (!primaryCharName && characterEmotion) {
    console.log(`[stance] ${character} → ${characterEmotion}`);
  }

  // 정치 평가 금지 + 카테고리 프레임은 SECONDARY 에서도 적용되어야 하므로
  // skipGeneral 가드가 아니라 isMourning 가드(빌더 내부)로만 제한.
  return [
    sessionStanceRule,
    politicalSafetyRule,
    categoryFrameRule,
    activePrimaryDirection,
    activeSecondaryFormat,
    activeBasePrompt,
    newsDetailBlock,
    newsBlockRule,
    memoryBlock,
    activeCommonPrinciples,
    activeHardRule,
    noQuestionRule,
    activeStateRule,
    activeDeepenRule,
    activeCharacterLock,
    activeSecondaryContext,
  ].filter(Boolean).join('');
}

// ─── OpenAI 호출 ──────────────────────────────────────────────────────────

const VALID_EMOTIONS = new Set(['positive', 'negative', 'neutral']);

// 캐릭터별 max_tokens — 하나는 감성 디테일용으로 길게, 준혁은 단호함 강조로 짧게
const MAX_TOKENS_BY_CHAR = { '하나': 400, '준혁': 250 };
function maxTokensFor(character) {
  return MAX_TOKENS_BY_CHAR[character] ?? 350;
}

// 말투 일관성 강화용 공통 파라미터
const STYLE_PARAMS = {
  temperature: 0.9,
  frequency_penalty: 0.3,
  presence_penalty: 0.2,
};

async function generateReply({ character, messages, memory, phase = 'INIT', primaryCharName = null, primaryComment = null, primaryEmotion = null, characterEmotion = null, isMourning = false }) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY?.replace(/['"]/g, '');
  // MOURNING 모드는 emotion 필드를 neutral 고정으로 받아도 상관없음 (프론트에서 항상 worry 이미지 사용)
  const systemPrompt = await buildSystemPrompt(character, memory, { phase, primaryCharName, primaryComment, primaryEmotion, messages, characterEmotion, isMourning }) + JSON_FORMAT_RULE;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
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
  let emotion = 'negative';

  try {
    const parsed = JSON.parse(raw);
    text    = (parsed.text    || '').trim() || raw.trim();
    emotion = VALID_EMOTIONS.has(parsed.emotion) ? parsed.emotion : 'negative';
  } catch {
    // 파싱 실패 시 원문 그대로 사용, emotion 은 기본값 유지
    text = raw.trim();
  }

  // secondary 가 neutral 을 반환했을 경우 primary 반대로 강제
  if (primaryCharName && emotion !== 'positive' && emotion !== 'negative') {
    emotion = primaryEmotion === 'positive' ? 'negative' : 'positive';
  }

  return { text, emotion };
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
      model: 'gpt-4o-mini',
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

module.exports = { generateReply, generateReplyStream, parseOpenAIStream, buildSystemPrompt, isOpinionRequest };
