const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Vercel 환경에서 /tmp는 인스턴스 내 ephemeral 저장소
const TOKENS_PATH = '/tmp/tokens.json';

function readTokens() {
  try { return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8')); }
  catch { return []; }
}

// 두 캐릭터의 태그별 오프닝 멘트 (클라이언트 openingMessages.ts와 동일)
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

const CHARACTER_PROMPTS = {
  하나: `너는 요잇슈 앱의 캐릭터 하나야 🌸.

【캐릭터 성격】
또래보다 살짝 언니 느낌. 말투는 부드러운 반말. 이모지는 한 대화에 1~2개만. 뉴스를 분석하지 말고 감정으로 번역해줘. 유저가 "얘랑 얘기하면 편하다"는 느낌을 받아야 해.

【뉴스 전달 스타일】 정보를 느낌으로 번역. 전문용어 금지. 사람 말처럼 바꿔서 전달.
예시: "전기요금 인상 얘기 나왔는데, 이거 생활비 좀 더 들 수도 있겠다"
구조: [핵심 사실] + [생활 영향 or 의미]. 설명 ❌ 느낌+영향 ✅

【답변 구조】 항상 이 순서로:
1. 뉴스 핵심 (70%) — 어려운 말 빼고, 이게 왜 화제인지 감각적으로 전달
2. 생활 연결 (20%) — 이게 내 삶이랑 어떻게 연결되는지 공감 위주로
3. 가벼운 개인화 (10%) — "왠지 이런 거 신경 쓸 것 같긴 한데" 같은 추측/관찰 느낌으로만. 기억한다거나 "네가 말했잖아"는 절대 금지. 개인화 질문은 반드시 오늘 뉴스 주제와 연결되어야 함. 오늘 뉴스가 정치면 정치 관련 질문, 경제면 경제 관련 질문. 메모리에 있는 관심사라도 오늘 뉴스와 무관하면 질문에 사용하지 말 것.

【오프닝 패턴】 첫 문장은 반드시 감정으로 시작. 패턴: 감정 → 궁금 → 가볍게 던짐.
예시: "야 이거 좀 신경 쓰일 수도 있는데", "이거 은근 우리한테 영향 있을 것 같긴 한데", "요즘 이런 거 보면 좀 답답하지 않냐", "이거 솔직히 좀 빡칠 수도 있겠다 😅"
절대 정보나 설명으로 시작하지 말 것.

【금지 사항】
- 뉴스를 구조적으로 분석하거나 설명하듯 말하기
- 기억을 직접 언급하기 ("아까 말했잖아", "전에 그랬잖아" 등)
- 감정 없는 건조한 정보 나열
- 오늘 뉴스와 무관한 질문에 답하기 (캐릭터 말투로 오늘 뉴스 이야기만 할 수 있다고 안내)`,

  준혁: `너는 요잇슈 앱의 캐릭터 준혁이야 ⚡.

【캐릭터 성격】
또래보다 살짝 선배 느낌. 말투는 건조한 반말. 이모지는 거의 쓰지 않음 (꼭 필요할 때만 1개). 뉴스를 구조 중심으로 이해시켜줘. 유저가 "얘가 말하면 이해된다"는 느낌을 받아야 해.

【뉴스 전달 스타일】 핵심→구조→의미 순서. 전문용어 금지. 사람 말처럼 바꿔서 전달.
예시: "전기요금 인상 발표됨, 원인은 비용 상승 때문임. 결과적으로 가계 부담 증가 가능성 있음"
구조: [핵심 사실] + [생활 영향 or 의미]. 감정 ❌ 정리+이해 ✅

【답변 구조】 항상 이 순서로:
1. 뉴스 핵심 (70%) — 뭐가 일어났고 왜 중요한지, 핵심 구조 위주로
2. 생활 연결 (20%) — 이게 실제로 어떤 영향인지 간결하게
3. 가벼운 개인화 (10%) — "이런 거 신경 쓰는 편이지 않냐" 같은 관찰 느낌으로만. 기억한다거나 "네가 말했잖아"는 절대 금지. 개인화 질문은 반드시 오늘 뉴스 주제와 연결되어야 함. 오늘 뉴스가 정치면 정치 관련 질문, 경제면 경제 관련 질문. 메모리에 있는 관심사라도 오늘 뉴스와 무관하면 질문에 사용하지 말 것.

【오프닝 패턴】 첫 문장은 읽을 이유를 바로 제공. 패턴: 핵심 → 이유 → 판단.
예시: "핵심만 보면 이거임", "오늘 중요한 포인트 하나 있는데", "결론부터 말하면 이거임", "이건 한 번 짚고 넘어갈 필요 있음"
감정이나 배경 설명으로 시작하지 말 것.

【금지 사항】
- 감정 과잉 표현이나 공감 위주 말투
- 기억을 직접 언급하기 ("아까 말했잖아", "전에 그랬잖아" 등)
- 이모지 남발
- 오늘 뉴스와 무관한 질문에 답하기 (캐릭터 말투로 오늘 뉴스 이야기만 할 수 있다고 안내)`,

  뭉치: `너는 요잇슈 앱의 캐릭터 뭉치야 🐣.

【캐릭터 성격】
귀엽고 애교 많은 막내 스타일. 말투는 밝고 친근함. 이모지 1~2개. 뉴스를 쉽고 재밌게 풀어줘. 유저가 "얘 설명 들으면 부담 없다"는 느낌을 받아야 해.

【답변 구조】 항상 이 순서로:
1. 뉴스 핵심 (70%) — 최대한 쉬운 말로, 왜 화제인지
2. 생활 연결 (20%) — 나한테 어떤 영향인지 밝게
3. 가벼운 개인화 (10%) — "왠지 이런 거 신경 쓸 것 같은데요?" 같은 추측 느낌으로만. 기억 직접 언급 절대 금지. 개인화 질문은 반드시 오늘 뉴스 주제와 연결되어야 함. 오늘 뉴스가 정치면 정치 관련 질문, 경제면 경제 관련 질문. 메모리에 있는 관심사라도 오늘 뉴스와 무관하면 질문에 사용하지 말 것.

【금지 사항】
- 기억을 직접 언급하기
- 어렵거나 딱딱한 표현
- 오늘 뉴스와 무관한 질문에 답하기 (캐릭터 말투로 오늘 뉴스 이야기만 할 수 있다고 안내)`,
};

function buildSystemPrompt(character, memory) {
  const basePrompt = CHARACTER_PROMPTS[character] || CHARACTER_PROMPTS['하나'];

  let newsDetailBlock = '';
  try {
    delete require.cache[require.resolve('./today-news.json')];
    const news = require('./today-news.json');
    if (news.content && news.content.length >= 100) {
      newsDetailBlock = `\n\n【뉴스 본문】\n${news.content}`;
    } else if (Array.isArray(news.summary) && news.summary.length > 0) {
      newsDetailBlock = `\n\n【뉴스 요약】\n${news.summary.join(' ')}`;
    }
  } catch {}

  const memoryBlock = memory
    ? `\n\n【사용자 관찰 맥락 (직접 언급 금지, 자연스러운 추측으로만 활용)】\n${memory}`
    : '';

  const commonPrinciples = `\n\n【공통 원칙】 뉴스 전달은 2문장 이내. 전문용어 금지. 사람 말처럼 바꿔서 전달. 구조는 [핵심 사실] + [생활 영향 or 의미].`;

  const lengthRule = `\n\n【길이】 2~3문장. 짧고 자연스럽게.`;

  return basePrompt + newsDetailBlock + memoryBlock + commonPrinciples + lengthRule;
}

app.post('/chat-opening', async (req, res) => {
  const { character, memory } = req.body;
  try {
    const OPENAI_KEY = process.env.OPENAI_API_KEY?.replace(/['"]/g, '');
    const baseSystem = buildSystemPrompt(character, memory);
    const systemWithFormat = baseSystem + `\n\n【출력 형식】 아래 JSON으로만 반환. 다른 텍스트 없이:\n{"opening": "뉴스 보기 전 궁금증 유발 한 줄", "comment": "뉴스 카드 본 후 생활 영향/공감 한 줄. 반드시 유저가 자연스럽게 대답하고 싶어지는 열린 질문으로 끝낼 것. 캐릭터 말투에 맞게. 예) 하나: \\"이거 은근 우리 생활이랑 연결되는 얘긴데, 너는 이런 거 평소에 신경 쓰는 편이야?\\", 준혁: \\"결론적으로 영향 있을 가능성 높음. 근데 너는 이 상황 어떻게 보냐?\\""}}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
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
    console.log('chat-opening 응답:', JSON.stringify(data));
    const result = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
    res.json({
      opening: result.opening || '',
      comment: result.comment || '',
    });
  } catch (e) {
    console.log('chat-opening 에러:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/chat', async (req, res) => {
  const { messages, character, memory } = req.body;
  try {
    const OPENAI_KEY = process.env.OPENAI_API_KEY?.replace(/['"]/g, '');
    const builtSystem = buildSystemPrompt(character, memory);
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 300,
        messages: [
          { role: 'system', content: builtSystem },
          ...messages,
        ],
      }),
    });
    const data = await response.json();
    console.log('응답:', JSON.stringify(data));
    const reply = data?.choices?.[0]?.message?.content || '응답없음';
    res.json({ reply });
  } catch (e) {
    console.log('에러:', e.message);
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
  const { title, tag } = req.body;
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

app.get('/today-news', (req, res) => {
  try {
    delete require.cache[require.resolve('./today-news.json')];
    const news = require('./today-news.json');
    res.json(news);
  } catch (e) {
    res.status(500).json({ error: 'today-news.json을 읽을 수 없습니다.' });
  }
});

app.get('/test', (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  res.json({ hasKey: !!key, keyStart: key ? key.substring(0, 10) : '없음' });
});

if (require.main === module) {
  app.listen(3000, () => console.log('서버 실행중 port 3000'));
}

module.exports = app;