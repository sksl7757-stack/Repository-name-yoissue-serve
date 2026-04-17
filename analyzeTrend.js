'use strict';

// 뉴스 선택용 트렌드 분석
// 반환: { topics: [{ name, keywords, weight }], mainMood, reason }

async function analyzeTrend(newsList, openaiKey) {
  const today   = new Date().toISOString().slice(0, 10);
  const limited = newsList.slice(0, 20).map(item => ({
    title:           item.title,
    content_preview: (item.content || '').slice(0, 300),
  }));

  const prompt = `오늘 날짜: ${today}

아래 뉴스 목록 전체를 분석해서 오늘 뉴스의 흐름을 파악해줘.

### 요구 사항

1. 전체 뉴스를 카테고리별로 나눠서 topics를 만들어라
2. topics는 반드시 3개 이상, 최대 5개
3. 각 topic은 서로 다른 독립적인 흐름이어야 한다 (비슷한 것 중복 금지)
4. 하나의 키워드로 통합하지 마라
5. 각 topic의 keywords는 반드시 3~5개 포함
6. 각 topic의 weight는 전체 뉴스에서 그 흐름이 차지하는 비중 (0~1, 전체 합 ≈ 1)
7. mainMood: 오늘 뉴스 전반 분위기를 한 단어로 (긴장 / 우려 / 기대 / 혼란 / 분노 / 안정 등)
8. reason: 지금 이 시점에 이 뉴스들이 왜 중요한지 2~3문장, 각 문장 60자 이내, 핵심만 전달
   금지: "중요한 이슈다", "주목된다", "관심이 모인다" 같은 의미 없는 문장

### 응답 형식 (JSON만)

{
  "topics": [
    {
      "name": "흐름을 한 문장으로 설명",
      "keywords": ["키워드1", "키워드2", "키워드3"],
      "weight": 0.0
    }
  ],
  "mainMood": "분위기 한 단어",
  "reason": "지금 이 뉴스들이 왜 중요한지 — 2~3문장, 각 60자 이내"
}

### 뉴스 목록

${JSON.stringify(limited, null, 2)}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 800,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error('OpenAI 오류: ' + data.error.message);
  const parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}');

  // 최소 검증
  if (!Array.isArray(parsed.topics) || parsed.topics.length < 1) {
    throw new Error('analyzeTrend: topics 배열이 없거나 비어 있음');
  }

  return parsed;
}

module.exports = { analyzeTrend };
