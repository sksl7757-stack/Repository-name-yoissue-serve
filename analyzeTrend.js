async function analyzeTrend(newsList, openaiKey) {
  const today = new Date().toISOString().slice(0, 10);
  const limited = newsList.slice(0, 20).map(item => ({
    title: item.title,
    content_preview: item.content.slice(0, 300),
  }));

  const prompt = `오늘 날짜: ${today}

다음 뉴스 목록 전체를 분석해서 오늘의 트렌드를 파악해줘.

전체 뉴스 목록을 훑으며 다음을 파악해:
- mainTopic: 오늘 뉴스들에서 가장 많이 반복되는 공통 주제/흐름을 한 문장으로
- mainKeyword: 전체 뉴스에서 가장 자주 등장하는 핵심 단어 1개 (예: 관세, 금리, 탄핵, AI 등)
- mainMood: 오늘 뉴스 전반의 감정/분위기를 한 단어로 (예: 긴장, 우려, 기대, 혼란, 분노 등)
- reason: 이 이슈가 지금 왜 중요한지를 구체적인 맥락으로 설명해. 2~3문장으로 작성. 각 문장은 60자 이내로 간결하게 유지하고, 수식어는 제거하고 핵심만 전달해.
  금지: "중요한 이슈다", "주목된다", "관심이 모인다" 같은 의미 없는 일반 문장
  요구: 지금 이 시점에 이 일이 벌어지는 배경, 실제로 어떤 상황이 달라지는지, 혹은 앞으로 어떤 일이 생길 수 있는지를 자연스럽게 서술

아래 JSON 형식으로만 응답해:
{
  "mainTopic": "오늘 뉴스 전체의 공통 주제/흐름 (한 문장)",
  "mainKeyword": "핵심 키워드 1개",
  "mainMood": "전반적 분위기 한 단어",
  "reason": "지금 이 이슈가 왜 중요한지 — 2~3문장, 각 문장 60자 이내, 핵심만"
}

뉴스 목록:
${JSON.stringify(limited, null, 2)}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 400,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error('OpenAI 오류: ' + data.error.message);
  const content = data?.choices?.[0]?.message?.content || '';
  return JSON.parse(content);
}

module.exports = { analyzeTrend };
