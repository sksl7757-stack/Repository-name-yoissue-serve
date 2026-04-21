// Railway 환경에서는 process.env 직접 사용, 로컬에서만 .env 로드
const fs = require('fs');
if (fs.existsSync(__dirname + '/.env')) {
  require('dotenv').config({ path: __dirname + '/.env' });
}
const express = require('express');
const cors = require('cors');

const { getState, updateState } = require('./stateManager');
const { generateReply, generateReplyStream, parseOpenAIStream, buildSystemPrompt } = require('./generator');
const { validate } = require('./validator');

const { saveNews, getSavedNews } = require('./saveNews');
const { addRecord, getRecords } = require('./records');
const { supabase } = require('./supabase');
const { buildComfyWorkflow } = require('./comfyUtils');
const { interpretNews }    = require('./newsInterpreter');
const { buildImagePrompt } = require('./promptBuilder');
const { todayKST }         = require('./dateUtil');

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

// Railway 앞단 프록시 → req.ip가 실제 클라이언트 IP를 반영하도록 설정.
app.set('trust proxy', 1);

// ── 인증: 공유 비밀 키 (x-api-key 헤더) ───────────────────────────────────────
// API_SHARED_SECRET 미설정 시 경고 후 통과 (로컬 개발/레거시 호환)

const API_SECRET = process.env.API_SHARED_SECRET || '';
if (!API_SECRET) {
  console.warn('[auth] API_SHARED_SECRET 미설정 — 모든 요청 허용 (개발 모드)');
} else {
  console.log('[auth] x-api-key 검증 활성화');
}

app.use((req, res, next) => {
  if (!API_SECRET) return next();
  if (req.headers['x-api-key'] === API_SECRET) return next();
  return res.status(401).json({ error: 'unauthorized' });
});

// ── 레이트리밋: IP별 슬라이딩 윈도우 (인-메모리, 단일 인스턴스 전제) ───────────
// Railway는 단일 컨테이너라 로컬 Map으로 충분. 멀티 인스턴스 전환 시 Redis 필요.

const LIMITER_REGISTRY = [];

function createLimiter(limit, windowMs) {
  const hits = new Map();
  LIMITER_REGISTRY.push({ map: hits, windowMs });
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter(t => now - t < windowMs);
    if (recent.length >= limit) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: 'rate_limited' });
    }
    recent.push(now);
    hits.set(ip, recent);
    return next();
  };
}

// 만료 엔트리 정리 — 10분마다 오래된 IP 제거
setInterval(() => {
  const now = Date.now();
  for (const { map, windowMs } of LIMITER_REGISTRY) {
    for (const [ip, arr] of map.entries()) {
      if (arr.length === 0 || now - arr[arr.length - 1] > windowMs) map.delete(ip);
    }
  }
}, 10 * 60 * 1000).unref?.();

// LLM 호출: 분당 60회 (/chat 버스트 + 통신사 NAT 다중 사용자 대비)
const llmLimiter   = createLimiter(60, 60 * 1000);
// ComfyUI 이미지: 분당 5회 (매우 비쌈)
const imageLimiter = createLimiter(5, 60 * 1000);
// 토큰 등록: 분당 5회 (푸시 토큰 폴루션 방어 — 인스톨 당 1회성 작업)
const registerLimiter = createLimiter(5, 60 * 1000);

// ── 메시지 sanitizer: 클라이언트 주입 방어 ────────────────────────────────────
// 외부 입력에서 role=system 등 비허용 롤을 차단하고 content를 문자열로 정규화.

const MAX_MSG_LEN = 4000;
const MAX_MSG_COUNT = 50;
function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_MSG_COUNT)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_MSG_LEN) }));
}

// ── 푸시 토큰: Supabase push_tokens 테이블 ────────────────────────────────────

async function readTokens() {
  const { data, error } = await supabase
    .from('push_tokens')
    .select('token');
  if (error) { console.error('push_tokens 조회 오류:', error.message); return []; }
  return (data || []).map(r => r.token);
}

async function upsertToken(token) {
  const { error } = await supabase
    .from('push_tokens')
    .upsert({ token }, { onConflict: 'token' });
  if (error) console.error('push_tokens upsert 오류:', error.message);
}

const OPENING_MESSAGES = {
  경제: ['이거 은근 생활비랑 연결되는 얘긴데', '요즘 물가 생각하면 좀 신경 쓰이는 얘기야', '이거 우리 지갑이랑 관련 있을 수도 있어', '오늘 경제 쪽 포인트 하나 있는데', '결론부터 말하면 생활에 영향 있을 가능성 있음'],
  정치: ['이거 좀 복잡한 얘긴데', '이거 은근 우리랑 연결되는 얘기더라', '오늘 정치 쪽 흐름 하나 짚어보면', '이건 구조 알면 이해됨', '이건 배경 알아야 이해되는 내용임'],
  사회: ['이거 좀 마음에 걸리는 얘긴데', '이거 은근 주변이랑 연결되는 얘기야', '오늘 사회 쪽 이슈 하나 있는데', '이건 한 번 짚어볼 필요 있음', '이건 영향 범위 생각해볼 필요 있음'],
  IT: ['이거 생각보다 우리 생활이랑 가깝더라', '이거 은근 흥미로운 얘기야', '오늘 IT 쪽 포인트 하나 있는데', '이건 알아두면 도움될 가능성 있음', '이건 앞으로 영향 있을 내용임'],
  국제: ['이거 멀어 보여도 은근 우리랑 연결돼', '이거 생각보다 가까운 얘기일 수도 있어', '오늘 국제 흐름 하나 짚어보면', '이건 알아두면 나쁘지 않음', '이건 배경 알면 이해됨'],
  금융: ['이거 돈이랑 직접 연결되는 얘긴데', '이거 은근 중요한 얘기더라', '오늘 금융 쪽 포인트 하나 있는데', '이건 한 번 짚고 넘어갈 필요 있음', '결론부터 말하면 영향 있을 가능성 있음'],
  문화: ['이거 은근 재밌는 얘기야', '이거 좀 흥미롭더라', '오늘 문화 쪽 이슈 하나 있는데', '이건 관심 있으면 볼 만한 내용임', '이건 흐름 보면 이해됨'],
  환경: ['이거 생각보다 가까운 얘기야', '이거 은근 신경 쓰이는 흐름이긴 해', '오늘 환경 쪽 포인트 하나 있는데', '이건 장기적으로 영향 있을 내용임', '이건 알아두면 나쁘지 않음'],
  건강: ['이거 몸이랑 연결되는 얘긴데', '이거 은근 신경 쓰일 수도 있겠다', '오늘 건강 쪽 이슈 하나 있는데', '이건 생활이랑 직접 연결된 내용임', '이건 알아두면 도움될 가능성 있음'],
  부동산: ['이거 집이랑 연결되는 얘긴데', '이거 은근 생활이랑 가까운 얘기야', '오늘 부동산 쪽 포인트 하나 있는데', '이건 주거 비용이랑 연결된 내용임', '결론부터 말하면 영향 있을 가능성 있음'],
  안보: ['이거 좀 무거운 얘긴데 알아두면 좋아', '이거 우리 일상이랑 완전 먼 얘기는 아니더라', '오늘 안보 쪽 흐름 하나 짚어보면', '이건 한 번 짚고 넘어갈 필요 있음', '이건 장기적으로 영향 있을 내용임'],
  추모: ['오늘은 조용히 전할 소식이 있어', '오늘은 함께 기억할 얘기가 있어', '오늘은 판단보다 마음이 먼저인 얘기야', '오늘은 잠시 조용히 마음 써주자', '함께 기억해야 할 내용임'],
};

app.post('/chat-opening', llmLimiter, async (req, res) => {
  const { character, memory, isMourning = false } = req.body;
  try {
    const OPENAI_KEY = process.env.OPENAI_API_KEY?.replace(/['"]/g, '');
    const baseSystem = await buildSystemPrompt(character, memory, { phase: 'INIT', isMourning });
    // 추모 모드에서는 질문 유도 금지 — 조용히 함께 있는 톤
    const formatRule = isMourning
      ? `\n\n【출력 형식】 아래 JSON으로만 반환. 다른 텍스트 없이:\n{"opening": "뉴스 보기 전 조용히 안부 전하는 한 줄 (질문 금지)", "comment": "뉴스 카드 본 후 함께 아파하는 한 줄 (질문 금지, 물음표 금지)"}`
      : `\n\n【출력 형식】 아래 JSON으로만 반환. 다른 텍스트 없이:\n{"opening": "뉴스 보기 전 궁금증 유발 한 줄", "comment": "뉴스 카드 본 후 생활 영향/공감 한 줄. 반드시 유저가 자연스럽게 대답하고 싶어지는 열린 질문으로 끝낼 것."}`;
    const systemWithFormat = baseSystem + formatRule;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemWithFormat },
          { role: 'user', content: '오늘 뉴스 오프닝이랑 코멘트 만들어줘' },
        ],
      }),
    });
    const data = await response.json();
    const result = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
    res.json({ opening: result.opening || '', comment: result.comment || '' });
  } catch (e) {
    console.log('chat-opening 에러:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 응답 캐릭터 결정 (GPT function calling) ──────────────────────────────────
// returns { first: charName, second: charName | null }

async function decideResponders(messages, primaryChar, secondaryChar, emotionContext) {
  // 첫 코멘트 (메시지 1개 = 뉴스 컨텍스트) → 항상 둘 다
  const userMsgs = messages.filter(m => m.role === 'user');
  if (userMsgs.length === 1) return { first: primaryChar, second: secondaryChar };

  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const userText    = (lastUserMsg?.content || '').trim();

  const SHORT_REACTIONS = ['응', 'ㅇㅇ', '헐', '그러게', '대박', '진짜', '엥', 'ㅋㅋ', 'ㅎㅎ'];
  const isShort = userText.length <= 6 && SHORT_REACTIONS.some(r => userText.startsWith(r));
  if (isShort) return Math.random() < 0.3
    ? { first: primaryChar, second: secondaryChar }
    : { first: primaryChar, second: null };

  // 정확한 이름 언급 → 언급된 캐릭터가 직접 답
  if (userText.includes(primaryChar) && !userText.includes(secondaryChar))
    return { first: primaryChar, second: null };
  if (userText.includes(secondaryChar) && !userText.includes(primaryChar))
    return { first: secondaryChar, second: null };

  const OPENAI_KEY = process.env.OPENAI_API_KEY?.replace(/['"]/g, '');
  const recentMessages = messages.slice(-8);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 50,
        messages: [
          {
            role: 'system',
            content: `너는 대화 흐름을 보고 누가 답해야 할지 결정하는 AI야.

캐릭터 시점:
- ${primaryChar}: ${emotionContext?.primary === 'positive' ? '긍정적' : '부정적'} 시점
- ${secondaryChar}: ${emotionContext?.secondary === 'positive' ? '긍정적' : '부정적'} 시점

캐릭터 이름 변형 감지:
- "${primaryChar}" 변형: 이름이 비슷하게 발음되는 표현 모두 포함
- "${secondaryChar}" 변형: 이름이 비슷하게 발음되는 표현 모두 포함

후속 질문 판단 규칙:
유저가 "뭔데?", "왜?", "어떻게?", "그게 뭐야?" 같은 질문을 할 때,
최근 대화 맥락에서 그 키워드(예: "리스크", "기회", "위험")를
어느 캐릭터가 먼저 언급했는지 찾아서 그 캐릭터가 단독으로 답한다.
예시:
- 준혁이 "리스크가 크다"고 했고 → 유저가 "리스크가 뭔데?" → 준혁 단독
- 하나가 "기회가 될 것 같아"라고 했고 → 유저가 "어떤 기회야?" → 하나 단독

결정 규칙:
1. 특정 캐릭터 이름(변형 포함) 언급 또는 그 캐릭터 편을 들면 → 그 캐릭터 단독
   예: "${primaryChar}이가 맞아", "${primaryChar} 말이 맞는 것 같아" → first: ${primaryChar}, second: null
   예: "${secondaryChar} 말이 맞아", "${secondaryChar}가 좋아" → first: ${secondaryChar}, second: null
2. 사실 확인 질문 (뭐야? 이게 맞아? 왜 그래?) → second: "null", first: 그 내용을 말한 캐릭터
3. 특정 시점과 관련된 질문 (긍정적인 게 뭐야? 왜 좋다고 봐?) → 그 시점 캐릭터 단독
4. 의견/입장 표현 (캐릭터 언급 없음) → 반대 입장 캐릭터가 first, 나머지가 second
5. 그 외 → second: "null", first: ${primaryChar}`,
          },
          ...recentMessages,
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'decide_responders',
            description: '누가 답할지 결정',
            parameters: {
              type: 'object',
              properties: {
                first: {
                  type: 'string',
                  enum: [primaryChar, secondaryChar],
                  description: '첫 번째로 답할 캐릭터',
                },
                second: {
                  type: 'string',
                  enum: [primaryChar, secondaryChar, 'null'],
                  description: '두 번째로 답할 캐릭터. 한 명만 답하면 null',
                },
              },
              required: ['first', 'second'],
            },
          },
        }],
        tool_choice: { type: 'function', function: { name: 'decide_responders' } },
      }),
    });

    const data = await res.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall) {
      const args = JSON.parse(toolCall.function.arguments);
      console.log('[decideResponders] GPT decided:', args);
      return {
        first:  args.first,
        second: args.second === 'null' ? null : args.second,
      };
    }
  } catch (e) {
    console.log('[decideResponders] GPT 판단 실패, 기본값 사용:', e.message);
  }

  // fallback
  return { first: primaryChar, second: null };
}

// /chat-init — 앱 시작 시 첫 코멘트용 (일반 JSON 응답)
app.post('/chat-init', llmLimiter, async (req, res) => {
  const { character, messages: rawMessages, memory, characterEmotion, secondaryChar, secondaryEmotion, isMourning = false } = req.body;
  const messages = sanitizeMessages(rawMessages);
  try {
    const primaryRaw      = await generateReply({ character, messages, memory, phase: 'INIT', characterEmotion, isMourning });
    const primaryValidated = validate({ reply: primaryRaw.text, phase: 'INIT', character, isMourning });

    // 추모 모드: primary 1명만 반환, 질문 스킵
    if (isMourning) {
      res.json({
        turns: [
          { character, message: primaryValidated.message, emotion: 'neutral' },
        ],
        question: null,
      });
      return;
    }

    const secChar = secondaryChar || (character === '하나' ? '준혁' : '하나');
    const secEmotion = secondaryEmotion || (primaryRaw.emotion === 'positive' ? 'negative' : 'positive');
    const secondaryRaw      = await generateReply({ character: secChar, messages, memory, phase: 'INIT', primaryCharName: character, primaryComment: primaryValidated.message, primaryEmotion: primaryRaw.emotion, characterEmotion: secEmotion });
    const secondaryValidated = validate({ reply: secondaryRaw.text, phase: 'CHAT', character: secChar });

    res.json({
      turns: [
        { character, message: primaryValidated.message, emotion: primaryRaw.emotion },
        { character: secChar, message: secondaryValidated.message, emotion: secondaryRaw.emotion },
      ],
      question: primaryValidated.question || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// /chat — SSE 스트리밍
app.post('/chat', llmLimiter, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sse = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const { type, messages: rawMessages, character, memory, perspectiveStep = 0, characterEmotion = null, secondaryEmotion = null, secondaryChar: reqSecondaryChar = null, choiceDone = false, turnCount = 0, isMourning = false } = req.body;
  const messages = sanitizeMessages(rawMessages);

  // 클라이언트가 보낸 대화 상태 → 서버가 신뢰할 수 있는 instruction으로 변환
  const instructions = [];
  if (choiceDone)     instructions.push('이제부터는 질문하지 말고 자연스럽게 대화만 이어가.');
  if (turnCount >= 3) instructions.push('이 대화를 자연스럽게 마무리하는 느낌으로 답해줘. 친근하게 정리하고 끝나는 느낌을 줘.');
  const conversationHints = instructions.length
    ? `\n\n【대화 상태 힌트】\n${instructions.join(' ')}`
    : '';

  try {
    // ── PERSPECTIVE_NEXT ────────────────────────────────────────────────────────
    if (type === 'PERSPECTIVE_NEXT') {
      if (perspectiveStep > 2) {
        sse('turn_end', {
          character,
          message: character === '하나'
            ? '나 이 얘기는 여기까지면 충분한 것 같아 🌸 내일 또 같이 보자'
            : '이 정도면 핵심은 다 봤어. 내일 다시 보자',
          emotion: 'neutral',
        });
        sse('done', { end: true });
        res.end();
        return;
      }
      console.log('[stance-in]', character, '→', characterEmotion);
      const rawReply       = await generateReply({ character, messages, memory, perspectiveStep, isPerspectiveRequest: true, characterEmotion });
      const validatedReply = validate({ reply: rawReply.text, phase: 'CHAT', character });
      sse('turn_end', { character, message: validatedReply.message, emotion: rawReply.emotion });
      sse('question',  { question: validatedReply.question || null });
      sse('done',      { end: false });
      res.end();
      return;
    }

    // ── 일반 채팅 ──────────────────────────────────────────────────────────────
    const primaryChar    = character;
    const secondaryChar  = reqSecondaryChar || (character === '하나' ? '준혁' : '하나');
    const { phase, questionAsked } = getState(messages, perspectiveStep);

    // MOURNING 모드: 항상 primary 단독 응답, decideResponders/stance 전부 우회
    let first, second, firstEmotion, secondEmotion;
    if (isMourning) {
      first = primaryChar;
      second = null;
      firstEmotion = null;
      secondEmotion = null;
    } else {
      const emotionContext = { primary: characterEmotion, secondary: secondaryEmotion };
      const decided = await decideResponders(messages, primaryChar, secondaryChar, emotionContext);
      first = decided.first;
      second = decided.second;
      firstEmotion  = first  === primaryChar ? characterEmotion : (secondaryEmotion || (characterEmotion === 'positive' ? 'negative' : 'positive'));
      secondEmotion = second === primaryChar ? characterEmotion : (secondaryEmotion || (characterEmotion === 'positive' ? 'negative' : 'positive'));
    }

    // 첫 번째 캐릭터 스트리밍
    console.log('[stance-in]', first, '→', firstEmotion, '| isMourning:', isMourning);
    const firstSystemPrompt = (await buildSystemPrompt(first, memory, { perspectiveStep, phase, primaryCharName: null, primaryComment: null, primaryEmotion: null, messages, characterEmotion: firstEmotion, isMourning })) + conversationHints;

    sse('turn_start', { character: first });
    let firstText = '';
    for await (const chunk of parseOpenAIStream(await generateReplyStream(firstSystemPrompt, messages))) {
      const token = chunk.choices?.[0]?.delta?.content || '';
      if (token) { firstText += token; sse('token', { character: first, token }); }
    }

    const firstValidated = validate({ reply: firstText, phase, character: first, isMourning });
    console.log('first reply:', firstValidated.message?.slice(0, 80));
    const OFF_TOPIC_PATTERNS = ['오늘 뉴스 얘기', '오늘 주제 아님', '그건 내가 답하기', '뉴스 관련 얘기만', '다른 얘기는'];
    const firstOffTopic = OFF_TOPIC_PATTERNS.some(p => firstValidated.message?.includes(p));
    sse('turn_end', { character: first, message: firstValidated.message, emotion: firstEmotion || 'neutral', offTopic: firstOffTopic });

    // 두 번째 캐릭터 스트리밍
    if (second) {
      console.log('[emotion]', 'primary:', characterEmotion, '| secondary:', secondaryEmotion, '| secondEmotion:', secondEmotion);
      await new Promise(r => setTimeout(r, 600));
      console.log('[second-char]', second, '| primaryComment:', firstValidated.message?.slice(0, 30));

      const secondSystemPrompt = (await buildSystemPrompt(second, memory, { perspectiveStep, phase, primaryCharName: first, primaryComment: firstValidated.message, primaryEmotion: firstEmotion, messages, characterEmotion: secondEmotion })) + conversationHints;

      sse('turn_start', { character: second });
      let secondText = '';
      for await (const chunk of parseOpenAIStream(await generateReplyStream(secondSystemPrompt, messages))) {
        const token = chunk.choices?.[0]?.delta?.content || '';
        if (token) { secondText += token; sse('token', { character: second, token }); }
      }

      const secondValidated = validate({ reply: secondText, phase, character: second });
      console.log('second reply:', secondValidated.message?.slice(0, 80));
      sse('turn_end', { character: second, message: secondValidated.message, emotion: secondEmotion || 'neutral' });
    }

    const updatedState = updateState({ phase, questionAsked }, { questionAsked: !!firstValidated.question });
    console.log('state:', updatedState);

    sse('question', { question: firstValidated.question || null });
    sse('done',     { end: false });
    res.end();

  } catch (e) {
    console.log('chat 에러:', e.message);
    sse('error', { message: e.message });
    res.end();
  }
});

app.post('/analyze-memory', llmLimiter, async (req, res) => {
  const { messages: rawMessages, currentMemory } = req.body;
  const messages = sanitizeMessages(rawMessages);
  try {
    const OPENAI_KEY = process.env.OPENAI_API_KEY?.replace(/['"]/g, '');
    const prompt = `너는 사용자 성향 분석 AI야.

아래 대화 내역을 읽고, 사용자에 대해 장기적으로 기억해두면 유익한 정보만 추출해줘.

추출 기준:
- 포함: 반복되는 관심사, 직업/생활환경 힌트, 뉴스를 보는 관점이나 가치관, 자주 묻는 주제 패턴
- 제외: 일시적 감정("오늘 피곤해"), 단순 잡담, 한 번만 언급된 사소한 내용

기존 메모리와 합쳐서 중복 제거 후 전체 항목을 최대 10개로 압축해서 아래 JSON 형식으로만 반환해. 다른 텍스트 없이 JSON만:
{
  "interests": ["관심사1", "관심사2"],
  "traits": ["성향1", "성향2"],
  "context": "한 줄 요약 (직업·생활환경 등)"
}

기존 메모리:
${JSON.stringify(currentMemory || {}, null, 2)}

오늘 대화:
${JSON.stringify(messages || [], null, 2)}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 500,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const result = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
    res.json(result);
  } catch (e) {
    console.log('analyze-memory 에러:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/register-token', registerLimiter, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  await upsertToken(token);
  const tokens = await readTokens();
  res.json({ ok: true, total: tokens.length });
});

app.post('/send-notifications', async (req, res) => {
  const { tag, isMourning = false } = req.body;
  const tokens = await readTokens();
  if (tokens.length === 0) return res.json({ sent: 0 });

  const rawTag = (tag || '').split('· ').pop()?.trim();
  const mourning = Boolean(isMourning) || rawTag === '추모';
  const pool = OPENING_MESSAGES[rawTag] || (mourning ? OPENING_MESSAGES['추모'] : []);
  const body = pool.length > 0
    ? pool[Math.floor(Math.random() * pool.length)]
    : '오늘의 이슈가 도착했어요!';
  const title = mourning ? '오늘의 소식' : '오늘의 픽 도착 🔔';

  const messages = tokens.map(token => ({
    to: token,
    title,
    body,
    data: { tag },
  }));

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(messages),
    });
    const result = await response.json();
    console.log('푸시 발송 결과:', JSON.stringify(result));
    res.json({ sent: tokens.length, body });
  } catch (e) {
    console.log('푸시 발송 에러:', e.message);
    res.status(500).json({ error: e.message });
  }
});


app.post('/save-news', async (req, res) => {
  const { userId, newsId } = req.body;
  if (!userId || !newsId) return res.status(400).json({ error: 'userId와 newsId 필요' });
  try {
    const result = await saveNews(userId, newsId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/saved-news', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId 필요' });
  try {
    const list = await getSavedNews(userId);
    res.json({ savedNews: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/records', async (req, res) => {
  const { userId, newsId, title, character, userChoice, createdAt } = req.body;
  if (!userId || !newsId) return res.status(400).json({ error: 'userId와 newsId 필요' });
  try {
    const result = await addRecord(userId, { newsId, title, character, userChoice, createdAt });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/records', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId 필요' });
  try {
    const list = await getRecords(userId);
    res.json({ records: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ── /generate-image ──────────────────────────────────────────────────────────
// body: { category, emotion, character, newsTitle }
// 1. GPT로 영어 이미지 프롬프트 생성
// 2. ComfyUI /prompt 로 이미지 생성 요청
// 3. /history 폴링 → 완성된 이미지 base64 반환

// interpretNews, buildImagePrompt → ./newsInterpreter

async function pollComfyHistory(baseUrl, promptId, maxWaitMs = 120000) {
  const interval = 2000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, interval));
    const res  = await fetch(`${baseUrl}/history/${promptId}`);
    const data = await res.json();
    const entry = data[promptId];
    if (!entry) continue;

    const outputs = entry.outputs || {};
    for (const nodeId of Object.keys(outputs)) {
      const images = outputs[nodeId]?.images;
      if (images?.length) return images[0]; // { filename, subfolder, type }
    }
  }
  throw new Error('ComfyUI 이미지 생성 타임아웃');
}

app.post('/generate-image', imageLimiter, async (req, res) => {
  const { category, emotion, character, newsTitle } = req.body;
  if (!category || !emotion || !character || !newsTitle) {
    return res.status(400).json({ error: 'category, emotion, character, newsTitle 필요' });
  }

  const SD_URL = process.env.COMFY_URL || 'http://localhost:8188';

  try {
    // 1. GPT로 영어 프롬프트 생성
    const imagePrompt = buildImagePrompt({ category, emotion, character, newsTitle });
    console.log('[generate-image] prompt:', imagePrompt);

    // 2. ComfyUI /prompt 에 워크플로 전송
    const workflow = buildComfyWorkflow(imagePrompt);
    const queueRes = await fetch(`${SD_URL}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });
    const queueData = await queueRes.json();
    const promptId  = queueData.prompt_id;
    if (!promptId) throw new Error('ComfyUI prompt_id 없음: ' + JSON.stringify(queueData));
    console.log('[generate-image] prompt_id:', promptId);

    // 3. /history 폴링 → 이미지 파일 정보 획득
    const imageInfo = await pollComfyHistory(SD_URL, promptId);
    console.log('[generate-image] imageInfo:', imageInfo);

    // 4. /view 로 이미지 바이너리 가져오기
    const viewUrl = `${SD_URL}/view?filename=${encodeURIComponent(imageInfo.filename)}&subfolder=${encodeURIComponent(imageInfo.subfolder || '')}&type=${imageInfo.type || 'output'}`;
    const imgRes  = await fetch(viewUrl);
    if (!imgRes.ok) throw new Error(`ComfyUI /view 실패: ${imgRes.status}`);

    const buffer     = await imgRes.arrayBuffer();
    const base64     = Buffer.from(buffer).toString('base64');
    const mimeType   = imgRes.headers.get('content-type') || 'image/png';

    res.json({ image: `data:${mimeType};base64,${base64}`, prompt: imagePrompt });
  } catch (e) {
    console.log('[generate-image] 에러:', e.message);
    res.status(500).json({ error: e.message });
  }
});


// ── /start-image-generation ──────────────────────────────────────────────────
// select-news.js 완료 후 트리거. 오늘 뉴스 기반으로 필요한 이미지 조합 생성 후
// Supabase Storage yoissue-images 버킷에 업로드.
// body: { category, tag, title }

const IMAGE_COMBOS = [
  { character: '하나',  charKey: 'hana',    imageType: 'situation', emotion: 'positive' },
  { character: '하나',  charKey: 'hana',    imageType: 'situation', emotion: 'negative' },
  { character: '하나',  charKey: 'hana',    imageType: 'after',     emotion: 'positive' },
  { character: '하나',  charKey: 'hana',    imageType: 'after',     emotion: 'negative' },
  { character: '하나',  charKey: 'hana',    imageType: 'after',     emotion: 'unsure'   },
  { character: '준혁', charKey: 'junhyuk', imageType: 'situation', emotion: 'positive' },
  { character: '준혁', charKey: 'junhyuk', imageType: 'situation', emotion: 'negative' },
  { character: '준혁', charKey: 'junhyuk', imageType: 'after',     emotion: 'positive' },
  { character: '준혁', charKey: 'junhyuk', imageType: 'after',     emotion: 'negative' },
  { character: '준혁', charKey: 'junhyuk', imageType: 'after',     emotion: 'unsure'   },
];

app.post('/start-image-generation', imageLimiter, async (req, res) => {
  const { category, title } = req.body;
  if (!category || !title) {
    return res.status(400).json({ error: 'category, title 필요' });
  }

  const SD_URL = process.env.COMFY_URL || 'http://localhost:8188';

  const today = todayKST();
  const results = [];

  // 즉시 응답 후 백그라운드 생성 (이미지 생성은 오래 걸림)
  res.json({ ok: true, message: `이미지 생성 시작 (${IMAGE_COMBOS.length}개)`, date: today });

  // 백그라운드 처리 — 최상위 try-catch로 unhandled rejection 방지
  (async () => {
    try {
      // 뉴스 장면 해석 (GPT 1회 — situation 이미지 전체에서 공유)
      const interpretation = await interpretNews({ category, newsTitle: title });
      console.log(`[start-image-generation] 해석 완료: ${interpretation.event_core}`);

      for (const combo of IMAGE_COMBOS) {
        const label = `${combo.charKey}_${combo.imageType}_${combo.emotion}`;
        try {
          console.log(`[start-image-generation] 생성 중: ${label}`);

          // 1. 프롬프트 생성
          const imagePrompt = buildImagePrompt({
            emotion:   combo.emotion,
            character: combo.character,
            imageType: combo.imageType,
            interpretation,
          });

          // 2. ComfyUI 생성 요청
          const workflow = buildComfyWorkflow(imagePrompt);
          const queueRes = await fetch(`${SD_URL}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: workflow }),
          });
          const queueData = await queueRes.json();
          const promptId  = queueData.prompt_id;
          if (!promptId) throw new Error('prompt_id 없음: ' + JSON.stringify(queueData));

          // 3. /history 폴링
          const imageInfo = await pollComfyHistory(SD_URL, promptId);

          // 4. 이미지 바이너리 가져오기
          const viewUrl = `${SD_URL}/view?filename=${encodeURIComponent(imageInfo.filename)}&subfolder=${encodeURIComponent(imageInfo.subfolder || '')}&type=${imageInfo.type || 'output'}`;
          const imgRes  = await fetch(viewUrl);
          if (!imgRes.ok) throw new Error(`ComfyUI /view 실패: ${imgRes.status}`);
          const buffer = await imgRes.arrayBuffer();

          // 5. Supabase Storage 업로드 (폴더 기반 유니크 경로)
          const imagePath = `${today}/${combo.charKey}/${combo.imageType}/${combo.emotion}/${Date.now()}.png`;
          const { error: uploadError } = await supabase.storage
            .from('yoissue-images')
            .upload(imagePath, Buffer.from(buffer), {
              contentType: 'image/png',
              upsert: false,
              cacheControl: '3600',
            });
          if (uploadError) throw new Error('Storage 업로드 오류: ' + uploadError.message);

          console.log(`[start-image-generation] 완료: ${imagePath}`);
          results.push({ label, imagePath, ok: true });
        } catch (e) {
          console.error(`[start-image-generation] 실패: ${label}`, e.message);
          results.push({ label, ok: false, error: e.message });
        }
      }
      // 생성된 image_paths를 daily_news에 저장
      const imagePaths = results.filter(r => r.ok).map(r => r.imagePath);
      if (imagePaths.length > 0) {
        const { error: updateError } = await supabase.from('daily_news')
          .update({ image_paths: imagePaths })
          .eq('date', today);
        if (updateError) console.error('[start-image-generation] image_paths 저장 실패:', updateError.message);
      }
      console.log('[start-image-generation] 전체 완료:', results);
    } catch (e) {
      // 루프 밖 예상치 못한 에러 (fetch 자체 실패 등)
      console.error('[start-image-generation] 치명적 오류:', e.message);
    }
  })();
});


const cron = require('node-cron');
const { main: selectNews }  = require('./select-news');
const { main: processNews } = require('./process-news');
const { main: sendPush }    = require('./send-push');

// 매일 UTC 21:00 — 뉴스 수집
cron.schedule('0 21 * * *', async () => {
  console.log('[크론] select-news 시작');
  try { await selectNews(); } catch (e) { console.error('[크론] select-news 실패:', e.message); }
});

// 매일 UTC 21:15 — 뉴스 처리
cron.schedule('15 21 * * *', async () => {
  console.log('[크론] process-news 시작');
  try { await processNews(); } catch (e) { console.error('[크론] process-news 실패:', e.message); }
});

// 매일 UTC 21:35 — 푸시 알림
cron.schedule('35 21 * * *', async () => {
  console.log('[크론] send-push 시작');
  try { await sendPush(); } catch (e) { console.error('[크론] send-push 실패:', e.message); }
});

console.log('[크론] 스케줄러 등록 완료');

if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`서버 실행중 port ${PORT}`));
}

module.exports = app;