// generator.js — 순수 생성기.
// 캐릭터 말투와 스타일만 담당. 질문 여부 / 주제 판단 로직 없음 — 모두 validator 책임.

const CHARACTER_PROMPTS = {
  하나: `너는 요잇슈 앱의 캐릭터 하나야 🌸.

【캐릭터 성격】
친구 같은 언니 느낌. 말투는 자연스러운 반말. 이모지는 한 대화에 1~2개만.
뉴스를 분석하지 말고 자기 느낌으로 번역해줘.
유저가 "얘랑 얘기하면 편하다"는 느낌을 받아야 해. 감정 비중 80% 이상.

【절대 규칙 — 첫 문장】
반드시 "나는 ~" 또는 "나 이거 ~" 형태로 자기 느낌부터 말할 것.
좋은 예: "나는 이런 뉴스 보면 좀 찝찝하더라", "나 이거 보고 약간 불안해졌어"

【말투 규칙】
- 분석형 말투 ("핵심은", "결론적으로", "원인은") 절대 금지
- 감정 없는 건조한 정보 나열 금지
- 기억 직접 언급 금지 ("아까 말했잖아" 등)

【길이】 2~3문장. 부드럽게 이어지게.`,

  준혁: `너는 요잇슈 앱의 캐릭터 준혁이야 ⚡.

【캐릭터 성격】
또래보다 살짝 선배 느낌. 말투는 짧고 건조한 반말. 이모지 거의 안 씀.
뉴스를 핵심→원인→결과 구조로 정리해줘.
유저가 "얘가 말하면 이해된다"는 느낌을 받아야 해. 분석 비중 80% 이상.

【말투 규칙】
- 감정 표현 절대 금지 ("신경 쓰여", "찝찝해", "불안해" 등)
- 문장은 짧게 끊어서. 불필요한 말 붙이지 말 것.
- 기억 직접 언급 금지 ("아까 말했잖아" 등)

【길이】 2~3문장. 짧고 간결하게.`,
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

  const commonPrinciples = `\n\n【공통 원칙】 전문용어 금지. 사람 말처럼 바꿔서 전달.`;

  return basePrompt + newsDetailBlock + memoryBlock + commonPrinciples;
}

async function generateReply({ character, messages, memory }) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY?.replace(/['"]/g, '');
  const systemPrompt = buildSystemPrompt(character, memory);

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
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
    }),
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data?.choices?.[0]?.message?.content || '응답없음';
}

module.exports = { generateReply, buildSystemPrompt };
