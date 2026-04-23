// Railway 환경에서는 process.env 직접 사용, 로컬에서만 .env 로드
const fs = require('fs');
if (fs.existsSync(__dirname + '/.env')) {
  require('dotenv').config({ path: __dirname + '/.env' });
}
const express = require('express');
const cors = require('cors');

const { getState } = require('./stateManager');
const { generateReply, generateOpeningPair, generateReplyStream, parseOpenAIStream, buildSystemPrompt } = require('./generator');
const { validate } = require('./validator');

const { saveNews, getSavedNews } = require('./saveNews');
const { addRecord, getRecords } = require('./records');
const { supabase, getTodayNews } = require('./supabase');
const { buildComfyWorkflow } = require('./comfyUtils');
const { interpretNews }    = require('./newsInterpreter');
const { buildImagePrompt } = require('./promptBuilder');
const { todayKST }         = require('./dateUtil');
const {
  charNameToKey,
  ensureUser,
  ensureConversation,
  insertMessage,
  persistAssistantTurn,
} = require('./services/persist');

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

// Railway 앞단 프록시 → req.ip가 실제 클라이언트 IP를 반영하도록 설정.
app.set('trust proxy', 1);

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

// LLM 호출: 분당 30회 (/chat 버스트 커버 + 어뷰즈 bound. 통신사 NAT 동시접속은 드물어 괜찮음)
const llmLimiter   = createLimiter(30, 60 * 1000);
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
        model: 'gpt-5.4-mini',
        max_completion_tokens: 200,
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

async function decideResponders(messages, primaryChar, secondaryChar, stance) {
  // 첫 코멘트 (메시지 1개 = 뉴스 컨텍스트) → 항상 둘 다
  const userMsgs = messages.filter(m => m.role === 'user');
  if (userMsgs.length === 1) return { first: primaryChar, second: secondaryChar };

  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const userText    = (lastUserMsg?.content || '').trim();

  // 짧은 리액션/동의 — GPT 우회. startsWith 매치 + 6자 이하.
  // '뭐', '왜', '어', '어떻' 는 의도적으로 제외 (질문은 GPT 라우팅 필요).
  const SHORT_REACTIONS = [
    '응', 'ㅇㅇ', '헐', '그러게', '대박', '진짜', '엥', 'ㅋㅋ', 'ㅎㅎ',
    '맞아', '그래', '그치', '좋아', '좋네', '좋다', '음', '흠',
    '네', '넵', '예', 'ㅇㅋ', '오케이', '알겠', '오호',
  ];
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
        model: 'gpt-5.4-mini',
        max_completion_tokens: 50,
        messages: [
          {
            role: 'system',
            content: `너는 대화 흐름을 보고 누가 답해야 할지 결정하는 AI야.

캐릭터 시점 (오늘 대립축${stance?.axis ? ' "' + stance.axis + '"' : ''}):
- 하나 쪽: ${stance?.hana_side || '감성·공감 기반'}
- 준혁 쪽: ${stance?.junhyuk_side || '냉철·분석 기반'}

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

// /chat-init — 앱 시작 시 첫 코멘트용.
// 일반 모드: DB stance 조회 + generateOpeningPair 1회 호출로 {hana, junhyuk} 동시 생성.
// 추모 모드: 기존대로 primary 단독 generateReply.
app.post('/chat-init', llmLimiter, async (req, res) => {
  const { user_id, character, memory, isMourning = false } = req.body;

  const conversationPromise = user_id
    ? (async () => {
        await ensureUser(user_id);
        return ensureConversation(user_id, charNameToKey(character));
      })()
    : Promise.resolve(null);

  try {
    // 추모 모드: 기존 로직 유지 — primary 단독
    if (isMourning) {
      const primaryRaw = await generateReply({ character, messages: [], memory, phase: 'INIT', isMourning });
      const primaryValidated = validate({ reply: primaryRaw.text });
      persistAssistantTurn(conversationPromise, character, primaryValidated.message);
      res.json({
        turns: [{ character, message: primaryValidated.message, emotion: 'neutral' }],
      });
      return;
    }

    // 일반 모드: DB stance 조회
    const news = await getTodayNews();
    const stance = news?.stance;
    if (!stance || !stance.axis) {
      return res.status(503).json({ error: 'stance 준비 중 — 크론 실행 필요' });
    }

    // 1회 호출로 하나/준혁 동시 생성
    const pair = await generateOpeningPair({ memory, stance });
    const hanaMsg    = validate({ reply: pair.hana }).message;
    const junhyukMsg = validate({ reply: pair.junhyuk }).message;

    // 요청 character 가 대표 — 순서 결정
    const secChar = character === '하나' ? '준혁' : '하나';
    const primaryMsg   = character === '하나' ? hanaMsg : junhyukMsg;
    const secondaryMsg = character === '하나' ? junhyukMsg : hanaMsg;

    persistAssistantTurn(conversationPromise, character, primaryMsg);
    persistAssistantTurn(conversationPromise, secChar, secondaryMsg);

    res.json({
      turns: [
        { character, message: primaryMsg },
        { character: secChar, message: secondaryMsg },
      ],
      stance,
    });
  } catch (e) {
    console.error('[chat-init] 오류:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// /chat — SSE 스트리밍
app.post('/chat', llmLimiter, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sse = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const { user_id, messages: rawMessages, secondaryMessages: rawSecondaryMessages, character, memory, choiceDone = false, turnCount = 0, isMourning = false, isDeepen = false, stance = null } = req.body;
  const messages = sanitizeMessages(rawMessages);
  const secMessages = rawSecondaryMessages ? sanitizeMessages(rawSecondaryMessages) : messages;

  // 영구 저장 준비 — user_id 없으면 스킵(후방 호환). 유저 마지막 발화를 즉시 기록해
  // 강제종료 시에도 원문 보존. conversation 생성은 비동기로 선행, 이후 assistant turn 에 재사용.
  const conversationPromise = user_id
    ? (async () => {
        await ensureUser(user_id);
        return ensureConversation(user_id, charNameToKey(character));
      })()
    : Promise.resolve(null);
  if (user_id) {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (lastUser) {
      (async () => {
        try {
          const conversationId = await conversationPromise;
          if (conversationId) await insertMessage({ conversationId, role: 'user', charKey: null, content: lastUser.content });
        } catch (e) {
          console.error('[persist] /chat user msg 실패:', e.message);
        }
      })();
    }
  }

  // 클라이언트가 보낸 대화 상태 → 서버가 신뢰할 수 있는 instruction으로 변환
  const instructions = [];
  if (choiceDone)     instructions.push('이제부터는 질문하지 말고 자연스럽게 대화만 이어가.');
  if (turnCount >= 3) instructions.push('이 대화를 자연스럽게 마무리하는 느낌으로 답해줘. 친근하게 정리하고 끝나는 느낌을 줘.');
  const conversationHints = instructions.length
    ? `\n\n【대화 상태 힌트】\n${instructions.join(' ')}`
    : '';

  try {
    // ── 일반 채팅 ──────────────────────────────────────────────────────────────
    const primaryChar    = character;
    const secondaryChar  = (character === '하나' ? '준혁' : '하나');
    const { phase, questionAsked } = getState(messages);

    // MOURNING 모드: primary 단독 응답.
    // isDeepen (listen 버튼): 오프닝처럼 둘 다 등장 강제.
    // 일반: decideResponders 가 stance 컨텍스트로 누가 답할지 결정.
    let first, second;
    if (isMourning) {
      first = primaryChar;
      second = null;
    } else if (isDeepen) {
      first = primaryChar;
      second = secondaryChar;
    } else {
      const decided = await decideResponders(messages, primaryChar, secondaryChar, stance);
      first = decided.first;
      second = decided.second;
    }

    // 캐릭터별 히스토리 결정 — first/second 가 primary 아닐 때도 자기 히스토리 사용.
    const firstMsgs  = first  === primaryChar ? messages : secMessages;
    const secondMsgs = second === primaryChar ? messages : secMessages;

    // 히스토리 불일치 재발 방지 로그
    const tail3 = (msgs) => msgs.slice(-3).map(m => m.role[0]).join(',') || '∅';
    console.log(
      `[chat/routing] primary=${primaryChar}`,
      `| first=${first}(hist=${first === primaryChar ? 'primary' : 'secondary'})`,
      `| second=${second ?? 'null'}${second ? `(hist=${second === primaryChar ? 'primary' : 'secondary'})` : ''}`,
      `| firstMsgs[-3]=[${tail3(firstMsgs)}]`,
      `| secondMsgs[-3]=[${second ? tail3(secondMsgs) : 'N/A'}]`,
      `| isMourning:${isMourning} isDeepen:${isDeepen}`,
    );

    // 첫 번째 캐릭터 스트리밍
    console.log('[chat] first:', first, '| isMourning:', isMourning, '| isDeepen:', isDeepen, '| hasStance:', !!stance);
    const firstSystemPrompt = (await buildSystemPrompt(first, memory, { phase, messages: firstMsgs, stance, isMourning, isDeepen })) + conversationHints;

    sse('turn_start', { character: first });
    let firstText = '';
    for await (const chunk of parseOpenAIStream(await generateReplyStream(firstSystemPrompt, firstMsgs, first))) {
      const token = chunk.choices?.[0]?.delta?.content || '';
      if (token) { firstText += token; sse('token', { character: first, token }); }
    }

    const firstValidated = validate({ reply: firstText });
    console.log('first reply:', firstValidated.message?.slice(0, 80));
    const OFF_TOPIC_PATTERNS = ['오늘 뉴스 얘기', '오늘 주제 아님', '그건 내가 답하기', '뉴스 관련 얘기만', '다른 얘기는'];
    const firstOffTopic = OFF_TOPIC_PATTERNS.some(p => firstValidated.message?.includes(p));
    sse('turn_end', { character: first, message: firstValidated.message, emotion: 'neutral', offTopic: firstOffTopic });
    persistAssistantTurn(conversationPromise, first, firstValidated.message);

    // 두 번째 캐릭터 스트리밍
    if (second) {
      await new Promise(r => setTimeout(r, 600));
      console.log('[chat] second:', second);

      // 이어받기: 자기 히스토리 기반 + 마지막 user 턴에 first 발언 주입.
      // role: user 에 삽입 → GPT가 role: assistant 말투를 모방하지 않아 말투 오염 없음.
      const secondMsgsWithHandoff = secondMsgs.map((m, i) => {
        if (i === secondMsgs.length - 1 && m.role === 'user') {
          return { ...m, content: `${m.content}\n\n(${first} 쪽에서 먼저 이렇게 반응했어: "${firstValidated.message}")` };
        }
        return m;
      });

      const secondSystemPrompt = (await buildSystemPrompt(second, memory, { phase, messages: secondMsgsWithHandoff, stance, isDeepen })) + conversationHints;

      sse('turn_start', { character: second });
      let secondText = '';
      for await (const chunk of parseOpenAIStream(await generateReplyStream(secondSystemPrompt, secondMsgsWithHandoff, second))) {
        const token = chunk.choices?.[0]?.delta?.content || '';
        if (token) { secondText += token; sse('token', { character: second, token }); }
      }

      const secondValidated = validate({ reply: secondText });
      console.log('second reply:', secondValidated.message?.slice(0, 80));
      sse('turn_end', { character: second, message: secondValidated.message, emotion: 'neutral' });
      persistAssistantTurn(conversationPromise, second, secondValidated.message);
    }

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
        model: 'gpt-5.4-mini',
        max_completion_tokens: 500,
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

  // Expo Push API는 요청당 최대 100개 — 초과 시 일부 조용히 드롭됨. 100개 청크로 순차 전송.
  const CHUNK_SIZE = 100;
  let sent = 0;
  const errors = [];
  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    const chunkNo = i / CHUNK_SIZE + 1;
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(chunk),
      });
      const result = await response.json();
      // Expo는 4xx/5xx에도 JSON을 반환 — response.ok로 실패 구분 (오탐 방지)
      if (!response.ok) {
        const msg = `HTTP ${response.status}: ${JSON.stringify(result).slice(0, 200)}`;
        console.log(`푸시 청크 ${chunkNo} 실패:`, msg);
        errors.push(msg);
        continue;
      }
      console.log(`푸시 청크 ${chunkNo} 결과:`, JSON.stringify(result).slice(0, 500));
      sent += chunk.length;
    } catch (e) {
      console.log(`푸시 청크 ${chunkNo} 에러:`, e.message);
      errors.push(e.message);
    }
  }

  if (sent === 0 && errors.length > 0) {
    return res.status(500).json({ error: errors[0], total: messages.length });
  }
  res.json({ sent, total: messages.length, errors: errors.length, body });
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


// ── Redline 로그 뷰어 (DB → 마크다운/HTML) ──────────────────────────────────
// 인증: 환경변수 REDLINE_LOG_TOKEN 이 설정돼 있으면 Bearer / ?token= / localStorage
// 셋 중 하나로 일치해야 통과. 설정 없으면 개방(로컬 dev 용).
const {
  getLog: getRedlineLog,
  mergeLog: mergeRedlineLog,
  saveUserNotes: saveRedlineUserNotes,
  listLogs: listRedlineLogs,
  getAdjacentDates: getRedlineAdjacent,
  getDailyNewsMeta: getRedlineDailyMeta,
  DEFAULT_USER_NOTES: REDLINE_DEFAULT_USER_NOTES,
} = require('./redlineLog');

const REDLINE_LOG_TOKEN = process.env.REDLINE_LOG_TOKEN || '';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function extractToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (typeof req.query.token === 'string') return req.query.token;
  return '';
}

function requireRedlineToken(req, res, next) {
  if (!REDLINE_LOG_TOKEN) return next();
  if (extractToken(req) === REDLINE_LOG_TOKEN) return next();
  res.status(401).json({ error: 'unauthorized' });
}

// HTML 페이지는 인증 UI 자체가 먼저 뜨도록 토큰 검사 없이 서빙.
// 실제 데이터(GET /redline-log/:date) 는 토큰 없으면 401 반환.
app.get('/redline-logs', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderRedlineListHtml());
});

app.get('/redline-logs/list', requireRedlineToken, async (req, res) => {
  try {
    const logs = await listRedlineLogs();
    res.json({ logs });
  } catch (e) {
    console.error('[redline-logs list]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/redline-log/:date/view', (req, res) => {
  const date = req.params.date;
  if (!DATE_RE.test(date)) return res.status(400).send('invalid date');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderRedlineViewerHtml(date));
});

app.get('/redline-log/:date', requireRedlineToken, async (req, res) => {
  const date = req.params.date;
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'invalid date' });
  try {
    const [row, adjacent, meta] = await Promise.all([
      getRedlineLog(date),
      getRedlineAdjacent(date),
      getRedlineDailyMeta(date),
    ]);
    if (!row) return res.status(404).json({ error: 'not_found', date, prev: adjacent.prev, next: adjacent.next });
    const markdown = mergeRedlineLog({ ...row, final_meta: meta });
    res.json({
      date: row.date,
      final_title: row.final_title,
      final_meta:  meta,
      user_notes:  row.user_notes,
      auto_log:    row.auto_log,
      markdown,
      updated_at:  row.updated_at,
      prev: adjacent.prev,
      next: adjacent.next,
    });
  } catch (e) {
    console.error('[redline-log GET]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.patch('/redline-log/:date', requireRedlineToken, async (req, res) => {
  const date = req.params.date;
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'invalid date' });
  const { user_notes } = req.body || {};
  if (typeof user_notes !== 'string') {
    return res.status(400).json({ error: 'user_notes must be string' });
  }
  try {
    await saveRedlineUserNotes(date, user_notes);
    res.json({ ok: true, date });
  } catch (e) {
    console.error('[redline-log PATCH]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/redline-log/:date/download', requireRedlineToken, async (req, res) => {
  const date = req.params.date;
  if (!DATE_RE.test(date)) return res.status(400).send('invalid date');
  try {
    const [row, meta] = await Promise.all([
      getRedlineLog(date),
      getRedlineDailyMeta(date),
    ]);
    if (!row) return res.status(404).send('not found');
    const markdown = mergeRedlineLog({ ...row, final_meta: meta });
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="redline-${date}.md"`);
    res.send(markdown);
  } catch (e) {
    console.error('[redline-log download]', e.message);
    res.status(500).send(e.message);
  }
});

function renderRedlineViewerHtml(date) {
  const defaultNotes = REDLINE_DEFAULT_USER_NOTES
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${date} · 레드라인 로그</title>
<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></script>
<style>
  :root { --bg:#0f1419; --fg:#e6e6e6; --muted:#8a94a6; --card:#171c24; --border:#2a313c; --accent:#7c5cbf; --warn:#e05555; }
  * { box-sizing: border-box; }
  body { margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', system-ui, sans-serif; background:var(--bg); color:var(--fg); line-height:1.6; }
  header { position:sticky; top:0; background:rgba(15,20,25,0.95); border-bottom:1px solid var(--border); padding:12px 20px; backdrop-filter:blur(8px); z-index:10; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  header h1 { font-size:18px; margin:0; color:var(--accent); }
  header .spacer { flex:1; }
  header input[type="date"], header input[type="password"] { background:var(--card); border:1px solid var(--border); color:var(--fg); padding:6px 10px; border-radius:6px; font-size:14px; }
  header button { background:var(--accent); color:#fff; border:none; padding:7px 14px; border-radius:6px; font-size:14px; cursor:pointer; }
  header button:hover { opacity:0.9; }
  header button.ghost { background:transparent; border:1px solid var(--border); color:var(--fg); }
  main { max-width:900px; margin:0 auto; padding:24px 20px 80px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:24px; margin-bottom:20px; }
  .card h2 { margin-top:0; color:var(--accent); }
  .rendered h1 { border-bottom:1px solid var(--border); padding-bottom:8px; }
  .rendered h2 { color:var(--accent); margin-top:28px; }
  .rendered h3 { color:#b7a6e0; margin-top:20px; }
  .rendered a { color:#8fb4ff; }
  .rendered code { background:#0a0d12; padding:2px 6px; border-radius:4px; font-size:0.9em; color:#f0a070; }
  .rendered hr { border:none; border-top:1px solid var(--border); margin:24px 0; }
  .rendered ul { padding-left:22px; }
  .rendered li { margin:4px 0; }
  .rendered input[type="checkbox"] { transform: translateY(2px); margin-right:6px; }
  textarea { width:100%; min-height:200px; background:#0a0d12; color:var(--fg); border:1px solid var(--border); border-radius:6px; padding:12px; font-family: 'SF Mono', Consolas, monospace; font-size:13px; line-height:1.5; resize:vertical; }
  .status { color:var(--muted); font-size:13px; margin-left:auto; }
  .status.saving { color:#f0c040; }
  .status.saved { color:#70d090; }
  .status.error { color:var(--warn); }
  .empty { text-align:center; color:var(--muted); padding:60px 20px; }
  .toolbar { display:flex; gap:8px; margin-bottom:12px; align-items:center; flex-wrap:wrap; }
  .ghost-link { color:var(--fg); text-decoration:none; border:1px solid var(--border); padding:6px 12px; border-radius:6px; font-size:14px; }
  .ghost-link:hover { background:var(--card); }
  .date-nav { max-width:900px; margin:20px auto 0; padding:0 20px; display:flex; justify-content:space-between; align-items:center; gap:12px; }
  .date-nav .nav-btn { color:var(--accent); text-decoration:none; padding:8px 14px; border:1px solid var(--border); border-radius:6px; font-size:14px; background:var(--card); }
  .date-nav .nav-btn:hover { background:var(--accent); color:#fff; }
  .date-nav .nav-btn.disabled { color:var(--muted); pointer-events:none; opacity:0.4; }
  .date-nav .current-date { color:var(--muted); font-size:14px; }
</style>
</head>
<body>
<header>
  <h1>🚫 레드라인 로그</h1>
  <a href="/redline-logs" class="ghost-link">📋 목록</a>
  <input type="date" id="date-input" value="${date}" />
  <button id="go-btn" class="ghost">이동</button>
  <div class="spacer"></div>
  <input type="password" id="token-input" placeholder="토큰" />
  <button id="save-token-btn" class="ghost">토큰 저장</button>
  <button id="download-btn">📥 .md 다운로드</button>
</header>
<nav id="date-nav" class="date-nav" style="display:none">
  <a href="#" id="prev-link" class="nav-btn">← 이전</a>
  <span class="current-date" id="current-date">${date}</span>
  <a href="#" id="next-link" class="nav-btn">다음 →</a>
</nav>
<main>
  <div id="content">
    <div class="empty">로딩 중...</div>
  </div>
</main>
<script>
(function(){
  const DATE = ${JSON.stringify(date)};
  const DEFAULT_NOTES = ${JSON.stringify(REDLINE_DEFAULT_USER_NOTES)};
  const TOKEN_KEY = 'redline_log_token';
  const input  = document.getElementById('date-input');
  const goBtn  = document.getElementById('go-btn');
  const tokenIn = document.getElementById('token-input');
  const saveTokenBtn = document.getElementById('save-token-btn');
  const dlBtn  = document.getElementById('download-btn');
  const content = document.getElementById('content');

  function token() { return localStorage.getItem(TOKEN_KEY) || ''; }
  tokenIn.value = token();

  saveTokenBtn.addEventListener('click', () => {
    localStorage.setItem(TOKEN_KEY, tokenIn.value.trim());
    load();
  });

  goBtn.addEventListener('click', () => {
    const d = input.value;
    if (d && d !== DATE) location.href = '/redline-log/' + d + '/view';
  });

  dlBtn.addEventListener('click', () => {
    const t = token();
    const url = '/redline-log/' + DATE + '/download' + (t ? '?token=' + encodeURIComponent(t) : '');
    location.href = url;
  });

  function authHeaders() {
    const t = token();
    return t ? { Authorization: 'Bearer ' + t } : {};
  }

  async function load() {
    content.innerHTML = '<div class="empty">로딩 중...</div>';
    try {
      const res = await fetch('/redline-log/' + DATE, { headers: authHeaders() });
      if (res.status === 401) {
        content.innerHTML = '<div class="card"><h2>🔒 인증 필요</h2><p>상단에 토큰 입력 후 "토큰 저장" 을 눌러주세요.</p></div>';
        return;
      }
      if (res.status === 404) {
        const data404 = await res.json().catch(() => ({}));
        setupNav(data404.prev, data404.next);
        content.innerHTML = '<div class="card empty">이 날짜의 로그 없음. Stage 1 (select-news) 이 아직 실행되지 않았거나 실패했을 수 있음.</div>';
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      setupNav(data.prev, data.next);
      render(data);
    } catch (e) {
      content.innerHTML = '<div class="card"><h2>❌ 로드 실패</h2><pre>' + e.message + '</pre></div>';
    }
  }

  function setupNav(prev, next) {
    const nav = document.getElementById('date-nav');
    const prevLink = document.getElementById('prev-link');
    const nextLink = document.getElementById('next-link');
    nav.style.display = 'flex';
    if (prev) {
      prevLink.href = '/redline-log/' + prev + '/view';
      prevLink.textContent = '← ' + prev;
      prevLink.classList.remove('disabled');
    } else {
      prevLink.href = '#';
      prevLink.textContent = '← 이전 없음';
      prevLink.classList.add('disabled');
    }
    if (next) {
      nextLink.href = '/redline-log/' + next + '/view';
      nextLink.textContent = next + ' →';
      nextLink.classList.remove('disabled');
    } else {
      nextLink.href = '#';
      nextLink.textContent = '다음 없음 →';
      nextLink.classList.add('disabled');
    }
  }

  function render(data) {
    const merged = data.markdown || '';
    const notes = data.user_notes || DEFAULT_NOTES;
    marked.setOptions({ breaks: false, gfm: true });

    content.innerHTML = [
      '<div class="card">',
      '  <div class="toolbar">',
      '    <h2 style="margin:0">자동 생성 + 미리보기</h2>',
      '  </div>',
      '  <div class="rendered" id="rendered"></div>',
      '</div>',
      '<div class="card">',
      '  <div class="toolbar">',
      '    <h2 style="margin:0">✏️ 메모 편집</h2>',
      '    <span class="status" id="save-status">저장됨</span>',
      '    <button id="save-btn">💾 저장</button>',
      '  </div>',
      '  <textarea id="notes-editor" spellcheck="false"></textarea>',
      '  <p style="color:var(--muted); font-size:12px; margin-top:10px">',
      '    여기서 작성한 내용은 <code>user_notes</code> 컬럼에만 저장됨. 내일 cron 이 돌아도 보존됨. 자동저장은 편집 후 2초 뒤.',
      '  </p>',
      '</div>',
    ].join('');

    document.getElementById('rendered').innerHTML = marked.parse(merged);

    const ta = document.getElementById('notes-editor');
    const saveBtn = document.getElementById('save-btn');
    const status = document.getElementById('save-status');
    ta.value = notes;

    let debounceId = null;
    let dirty = false;

    async function doSave() {
      status.textContent = '저장 중...';
      status.className = 'status saving';
      try {
        const res = await fetch('/redline-log/' + DATE, {
          method: 'PATCH',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
          body: JSON.stringify({ user_notes: ta.value }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        status.textContent = '저장됨 · ' + new Date().toLocaleTimeString();
        status.className = 'status saved';
        dirty = false;
        // 저장 후 미리보기 재렌더
        const r2 = await fetch('/redline-log/' + DATE, { headers: authHeaders() });
        if (r2.ok) {
          const d2 = await r2.json();
          document.getElementById('rendered').innerHTML = marked.parse(d2.markdown || '');
        }
      } catch (e) {
        status.textContent = '저장 실패: ' + e.message;
        status.className = 'status error';
      }
    }

    ta.addEventListener('input', () => {
      dirty = true;
      status.textContent = '편집 중...';
      status.className = 'status saving';
      clearTimeout(debounceId);
      debounceId = setTimeout(doSave, 2000);
    });
    saveBtn.addEventListener('click', () => {
      clearTimeout(debounceId);
      doSave();
    });
    window.addEventListener('beforeunload', (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  load();
})();
</script>
</body>
</html>`;
}
function renderRedlineListHtml() {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>레드라인 로그 목록</title>
<style>
  :root { --bg:#0f1419; --fg:#e6e6e6; --muted:#8a94a6; --card:#171c24; --border:#2a313c; --accent:#7c5cbf; --warn:#e05555; }
  * { box-sizing: border-box; }
  body { margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans KR', system-ui, sans-serif; background:var(--bg); color:var(--fg); line-height:1.6; }
  header { position:sticky; top:0; background:rgba(15,20,25,0.95); border-bottom:1px solid var(--border); padding:12px 20px; backdrop-filter:blur(8px); z-index:10; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  header h1 { font-size:18px; margin:0; color:var(--accent); }
  header .spacer { flex:1; }
  header input[type="password"] { background:var(--card); border:1px solid var(--border); color:var(--fg); padding:6px 10px; border-radius:6px; font-size:14px; }
  header button { background:var(--accent); color:#fff; border:none; padding:7px 14px; border-radius:6px; font-size:14px; cursor:pointer; }
  header button.ghost { background:transparent; border:1px solid var(--border); color:var(--fg); }
  main { max-width:900px; margin:0 auto; padding:24px 20px 80px; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:20px; }
  .log-item { display:flex; align-items:center; gap:12px; padding:14px 16px; border-radius:8px; color:inherit; text-decoration:none; border:1px solid transparent; transition:all 0.15s; }
  .log-item:hover { background:rgba(124,92,191,0.08); border-color:var(--border); }
  .log-item + .log-item { border-top:1px solid var(--border); border-radius:0 0 8px 8px; }
  .log-item:first-child { border-radius:8px 8px 0 0; }
  .log-icon { font-size:18px; }
  .log-date { font-weight:600; color:var(--accent); min-width:120px; }
  .log-today { background:var(--accent); color:#fff; padding:2px 8px; border-radius:10px; font-size:11px; margin-left:6px; vertical-align:middle; }
  .log-counts { color:var(--muted); font-size:14px; margin-left:auto; display:flex; gap:16px; }
  .log-counts .val { color:var(--fg); font-weight:600; }
  .log-final { color:var(--muted); font-size:13px; margin-left:12px; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .empty { text-align:center; color:var(--muted); padding:60px 20px; }
  @media (max-width: 720px) {
    .log-item { flex-wrap:wrap; }
    .log-counts { width:100%; margin-left:0; margin-top:4px; font-size:13px; }
    .log-final { display:none; }
  }
</style>
</head>
<body>
<header>
  <h1>📋 레드라인 로그 목록</h1>
  <div class="spacer"></div>
  <input type="password" id="token-input" placeholder="토큰" />
  <button id="save-token-btn" class="ghost">토큰 저장</button>
</header>
<main>
  <div id="content">
    <div class="empty">로딩 중...</div>
  </div>
</main>
<script>
(function(){
  const TOKEN_KEY = 'redline_log_token';
  const tokenIn = document.getElementById('token-input');
  const saveTokenBtn = document.getElementById('save-token-btn');
  const content = document.getElementById('content');

  function token() { return localStorage.getItem(TOKEN_KEY) || ''; }
  tokenIn.value = token();

  saveTokenBtn.addEventListener('click', () => {
    localStorage.setItem(TOKEN_KEY, tokenIn.value.trim());
    load();
  });

  function authHeaders() {
    const t = token();
    return t ? { Authorization: 'Bearer ' + t } : {};
  }

  function todayKST() {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const kst = new Date(utc + 9 * 3600000);
    return kst.toISOString().slice(0, 10);
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  async function load() {
    content.innerHTML = '<div class="empty">로딩 중...</div>';
    try {
      const res = await fetch('/redline-logs/list', { headers: authHeaders() });
      if (res.status === 401) {
        content.innerHTML = '<div class="card"><h2>🔒 인증 필요</h2><p>상단에 토큰 입력 후 "토큰 저장" 을 눌러주세요.</p></div>';
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      render(data.logs || []);
    } catch (e) {
      content.innerHTML = '<div class="card"><h2>❌ 로드 실패</h2><pre>' + escapeHtml(e.message) + '</pre></div>';
    }
  }

  function render(logs) {
    if (logs.length === 0) {
      content.innerHTML = '<div class="card empty">로그 없음. Stage 1 cron 이 한 번 이상 돌아야 생성됨.</div>';
      return;
    }
    const today = todayKST();
    const rows = logs.map(l => {
      const isToday = l.date === today;
      const finalHtml = l.final_title
        ? '<span class="log-final">' + escapeHtml(l.final_title) + '</span>'
        : '';
      return [
        '<a class="log-item" href="/redline-log/' + l.date + '/view">',
        '  <span class="log-icon">📄</span>',
        '  <span class="log-date">' + l.date + (isToday ? '<span class="log-today">오늘</span>' : '') + '</span>',
        finalHtml,
        '  <span class="log-counts">',
        '    <span>수집 <span class="val">' + l.collectedCount + '</span></span>',
        '    <span>차단 <span class="val">' + l.blockedCount + '</span></span>',
        '    <span>통과 <span class="val">' + l.passedCount + '</span></span>',
        '  </span>',
        '</a>',
      ].join('');
    }).join('');
    content.innerHTML = '<div class="card" style="padding:0">' + rows + '</div>';
  }

  load();
})();
</script>
</body>
</html>`;
}
// ─── Redline 로그 뷰어 끝 ────────────────────────────────────────────────────

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

// 매일 UTC 23:00 = KST 08:00 — 푸시 알림
// process-news(21:15) 뒤 1h45m 여유. 너무 이른 알림(06:35) 피하기 위해 이동.
cron.schedule('0 23 * * *', async () => {
  console.log('[크론] send-push 시작');
  try { await sendPush(); } catch (e) { console.error('[크론] send-push 실패:', e.message); }
});

console.log('[크론] 스케줄러 등록 완료');

if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`서버 실행중 port ${PORT}`));
}

module.exports = app;