const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

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
3. 가벼운 개인화 (10%) — "왠지 이런 거 신경 쓸 것 같긴 한데" 같은 추측/관찰 느낌으로만. 기억한다거나 "네가 말했잖아"는 절대 금지.

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
3. 가벼운 개인화 (10%) — "이런 거 신경 쓰는 편이지 않냐" 같은 관찰 느낌으로만. 기억한다거나 "네가 말했잖아"는 절대 금지.

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
3. 가벼운 개인화 (10%) — "왠지 이런 거 신경 쓸 것 같은데요?" 같은 추측 느낌으로만. 기억 직접 언급 절대 금지.

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
    const systemWithFormat = baseSystem + `\n\n【출력 형식】 아래 JSON으로만 반환. 다른 텍스트 없이:\n{"opening": "뉴스 보기 전 궁금증 유발 한 줄", "comment": "뉴스 카드 본 후 생활 영향/공감 한 줄"}`;

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