const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/chat', async (req, res) => {
  const { messages, system } = req.body;
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer sk-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`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 300,
        messages: [
          { role: 'system', content: system },
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

app.get('/test', (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  res.json({ hasKey: !!key, keyStart: key ? key.substring(0, 10) : '없음' });
});

app.listen(3000, () => console.log('서버 실행중 port 3000'));