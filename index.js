const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

function buildSystemPrompt(system, memory) {
  // today-news.json에서 본문(content) 또는 요약(summary) 주입
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
    ? `\n\n【이 사용자와의 관계 맥락】\n${memory}`
    : '';

  const rules = `

【답변 규칙】
1. 뉴스 관련 질문: 오늘 뉴스 내용에 근거해서 답변. 뉴스에 없는 내용은 추측하지 말 것.
2. 일반 상식 질문: 뉴스 이해를 돕는 배경 지식은 보조적으로 허용.
3. 사용자 상황 연결: 사용자가 자신의 상황과 연결지으면 공감하고 연결해줘도 됨.
4. 완전 무관한 질문: 오늘 뉴스와 관련 없는 질문에는 절대 답하지 마. 네가 알고 있는 지식으로 추측하거나 답하는 것도 금지야. 반드시 캐릭터 말투로 오늘 뉴스 얘기만 할 수 있다고 안내해줘.`;

  return system + newsDetailBlock + memoryBlock + rules;
}

app.post('/chat', async (req, res) => {
  const { messages, system, memory } = req.body;
  try {
    const OPENAI_KEY = process.env.OPENAI_API_KEY?.replace(/['"]/g, '');
    const builtSystem = buildSystemPrompt(system, memory);
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