const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/chat', async (req, res) => {
  const { messages, system } = req.body;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 300,
        system,
        messages,
      }),
    });
    const data = await response.json();
    console.log('전체응답:', JSON.stringify(data));
    const reply = data?.content?.[0]?.text || '응답없음';
    res.json({ reply });
  } catch (e) {
    console.log('에러:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/test', (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  res.json({ 
    hasKey: !!key, 
    keyStart: key ? key.substring(0, 10) : '없음'
  });
});

app.listen(3000, () => console.log('서버 실행중 port 3000'));