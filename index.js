require('dotenv').config({ path: __dirname + '/.env' });
console.log('ENV PATH:', __dirname);
console.log('API KEY FULL:', process.env.OPENAI_API_KEY);
const express = require('express');
const cors = require('cors');
const fs = require('fs');

const { getState, updateState } = require('./stateManager');
const { filterTopic } = require('./topicFilter');
const { generateReply, buildSystemPrompt } = require('./generator');
const { validate } = require('./validator');
const { buildResponse } = require('./responseBuilder');

const app = express();
app.use(cors());
app.use(express.json());

// Vercel 환경에서 /tmp는 인스턴스 내 ephemeral 저장소
const TOKENS_PATH = '/tmp/tokens.json';

function readTokens() {
  try { return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8')); }
  catch { return []; }
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
};

app.post('/chat-opening', async (req, res) => {
  const { character, memory } = req.body;
  try {
    const OPENAI_KEY = process.env.OPENAI_API_KEY?.replace(/['"]/g, '');
    const baseSystem = buildSystemPrompt(character, memory);
    const systemWithFormat = baseSystem + `\n\n【출력 형식】 아래 JSON으로만 반환. 다른 텍스트 없이:\n{"opening": "뉴스 보기 전 궁금증 유발 한 줄", "comment": "뉴스 카드 본 후 생활 영향/공감 한 줄. 반드시 유저가 자연스럽게 대답하고 싶어지는 열린 질문으로 끝낼 것."}`;

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

// /chat — harness orchestration
app.post('/chat', async (req, res) => {
  const { messages, character, memory } = req.body;
  try {
    // 1. state 읽기 (코드에서만 결정 — LLM 관여 없음)
    const { phase, questionAsked } = getState(messages);

    // 2. topicFilter 실행
    const userInput = messages?.[messages.length - 1]?.content || '';
    let newsTitle = '';
    try {
      delete require.cache[require.resolve('./today-news.json')];
      newsTitle = require('./today-news.json').title || '';
    } catch {}
    let topicStatus = 'ON_TOPIC';
    if (phase === 'CHAT') {
      topicStatus = filterTopic(userInput, newsTitle);
    }

    // 3. generator 실행 (말투/스타일만 담당)
    const rawReply = await generateReply({ character, messages, memory });
    console.log('generator reply:', rawReply);

    // 4. validator 실행 (질문 추가/제거, 주제 이탈 — 코드에서만 결정)
    const validatedReply = validate({ reply: rawReply, phase, topicStatus, character });

    // 4-1. validator가 질문을 추가했으면 state 업데이트 (다음 요청 대비 로깅용)
    const updatedState = updateState({ phase, questionAsked }, {
      questionAsked: validatedReply.includes('?'),
    });
    console.log('state:', updatedState);

    // 5. responseBuilder로 최종 응답 생성
    res.json(buildResponse({ reply: validatedReply }));
  } catch (e) {
    console.log('chat 에러:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/analyze-memory', async (req, res) => {
  const { messages, currentMemory } = req.body;
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

app.post('/register-token', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  const tokens = readTokens();
  if (!tokens.includes(token)) {
    tokens.push(token);
    try { fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens), 'utf-8'); } catch {}
  }
  res.json({ ok: true, total: tokens.length });
});

app.post('/send-notifications', async (req, res) => {
  const { tag } = req.body;
  const tokens = readTokens();
  if (tokens.length === 0) return res.json({ sent: 0 });

  const rawTag = (tag || '').split('· ').pop()?.trim();
  const pool = OPENING_MESSAGES[rawTag] || [];
  const body = pool.length > 0
    ? pool[Math.floor(Math.random() * pool.length)]
    : '오늘의 이슈가 도착했어요!';

  const messages = tokens.map(token => ({
    to: token,
    title: '오늘의 픽 도착 🔔',
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

app.post('/today-news', (req, res) => {
  console.log('body:', req.body);
  try {
    delete require.cache[require.resolve('./today-news.json')];
    const news = require('./today-news.json');
    res.json(news);
  } catch (e) {
    console.log('today-news 에러:', e.message);
    res.status(500).json({ error: 'today-news.json을 읽을 수 없습니다.' });
  }
});

app.post('/today-news-test', (req, res) => {
  console.log('test route body:', req.body);
  res.json({ ok: true, message: 'test success' });
});

app.get('/test', (_req, res) => {
  const key = process.env.OPENAI_API_KEY;
  res.json({ hasKey: !!key, keyStart: key ? key.substring(0, 10) : '없음' });
});

if (require.main === module) {
  app.listen(4000, () => console.log('서버 실행중 port 4000'));
}

module.exports = app;