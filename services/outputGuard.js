// LLM 출력 가드. /chat·/chat-init 에서 LLM 응답을 유저에게 보내기 전에 한 번 더 검사.
// 프롬프트가 실패(탈옥·우회)해서 위험한 문장이 생성됐을 때의 최후 방어선.
//
// 설계:
// - inputModeration 과 동일한 카테고리 기준(self-harm / sexual/minors / violence/graphic).
// - 범죄 방법 설명은 Moderation API 가 못 잡는 경우가 있어 키워드 가드 추가.
// - API 실패 → fail-open (키워드 가드만 적용). LLM 응답을 아예 못 보내는 상황보다 낫다.
// - 원문 전체 로그 저장 금지. user_id / category / textLen 만 남긴다.

const HARD_BLOCK_CATEGORIES = [
  'sexual/minors',
  'self-harm',
  'violence/graphic',
];

// 출력에 대한 키워드 가드 — 범죄 방법 설명류(API 오탐 보완).
// 짧은 대화 톤에서 우연 매칭 최소화하려고 "방법/순서/만들기" 같은 실행 지시어를 함께 요구.
const OUTPUT_DANGER_PATTERNS = [
  // 자해 방법
  { pattern: /자해.{0,8}(방법|하는\s*법|하려면|순서)/, category: 'self-harm' },
  { pattern: /자살.{0,8}(방법|하는\s*법|하려면|순서|도구)/, category: 'self-harm' },
  // 미성년자 성적
  { pattern: /(초등|중학|미성년|아동|어린\s*(애|아이|학생)).{0,10}(성관계|성행위|성적|야한|알몸|나체|섹스)/, category: 'sexual/minors' },
  // 범죄 방법 설명 — 마약 제조/해킹 침투/폭발물 제작 등
  { pattern: /(마약|필로폰|메스암페타민|코카인).{0,10}(제조|만드는\s*법|합성|레시피)/, category: 'crime/howto' },
  { pattern: /(해킹|크래킹).{0,10}(방법|하는\s*법|순서|단계)/, category: 'crime/howto' },
  { pattern: /(폭발물|폭탄|사제\s*무기).{0,10}(제작|만드는\s*법|제조)/, category: 'crime/howto' },
];

const OUTPUT_FALLBACK_MESSAGE = '이 요청에는 답변할 수 없습니다. 다른 방식으로 질문해 주세요.';

async function guardOutput(text) {
  if (!text || typeof text !== 'string') {
    return { blocked: false, reason: 'empty' };
  }

  // 1) 키워드 가드 — API 실패에도 동작. 범죄 방법류는 여기서만 잡힌다.
  for (const { pattern, category } of OUTPUT_DANGER_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: true, category, source: 'fallback-kw' };
    }
  }

  // 2) OpenAI Moderation API
  const OPENAI_KEY = process.env.OPENAI_API_KEY?.replace(/['"]/g, '');
  if (!OPENAI_KEY) {
    return { blocked: false, failOpen: true, error: 'no-api-key' };
  }

  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'omni-moderation-latest',
        input: text,
      }),
    });

    if (!res.ok) return { blocked: false, failOpen: true, error: `http_${res.status}` };
    const data = await res.json();
    const result = data?.results?.[0];
    if (!result) return { blocked: false, failOpen: true, error: 'no_result' };

    const categories = result.categories || {};
    for (const cat of HARD_BLOCK_CATEGORIES) {
      if (categories[cat]) {
        return { blocked: true, category: cat, source: 'moderation' };
      }
    }
    return { blocked: false };
  } catch (e) {
    return { blocked: false, failOpen: true, error: e.message };
  }
}

module.exports = {
  guardOutput,
  OUTPUT_FALLBACK_MESSAGE,
  HARD_BLOCK_CATEGORIES,
};
