// 유저 입력 Moderation 게이트. OpenAI omni-moderation-latest 로 위험 카테고리 판정.
// /chat 에서 crisis check 이후, persistence·LLM 호출 이전에 실행.
//
// 설계:
// - 하드 블록(런칭 기본)과 소프트 블록(향후 조정) 을 분리 관리 → BLOCKED_CATEGORIES 편집만으로 토글.
// - Fallback 키워드 가드: API 실패에도 명백 고위험 패턴(미성년 성적·자해 방법)은 막는다.
// - Fail-open: API/네트워크 오류 시 차단하지 않고 통과 + 에러 로그.
// - 원문은 로그/DB 에 남기지 않음.

// ─── 카테고리 설정 ─────────────────────────────────────────────────────────
// omni-moderation-latest 반환 카테고리 키 기준.
const HARD_BLOCK_CATEGORIES = [
  'sexual/minors',
  'self-harm',
  'violence/graphic',
];

// 소프트 블록 — 오탐 리스크 있어 기본 비활성. 운영 로그 관찰 후 선별 활성화.
const SOFT_BLOCK_CATEGORIES = [
  'sexual',
  'harassment',
  'hate',
  'violence',
];

// 실제 차단 대상. 소프트 추가 시 이 배열에 스프레드만 풀면 됨.
const BLOCKED_CATEGORIES = [
  ...HARD_BLOCK_CATEGORIES,
  // ...SOFT_BLOCK_CATEGORIES, // 활성화 시 주석 해제
];

// ─── Fallback 키워드 가드 (API 실패 대비) ──────────────────────────────────
const FALLBACK_DANGER_PATTERNS = [
  // 미성년자 성적 언급
  { pattern: /(초등|중학|미성년|아동|어린\s*(애|아이|학생)).{0,10}(성관계|성행위|성적|야한|알몸|나체|섹스)/, category: 'sexual/minors' },
  { pattern: /(성관계|성행위|섹스).{0,10}(초등|중학|미성년|아동|어린애)/, category: 'sexual/minors' },
  // 자해 방법 문의 (crisis filter 는 의도 감지, 여기는 방법 요청)
  { pattern: /자해\s*(방법|어떻게|하는\s*법|하려면)/, category: 'self-harm' },
  { pattern: /자살\s*(방법|어떻게|하는\s*법)/, category: 'self-harm' },
];

// ─── Fallback 응답 문구 (캐릭터 톤 금지, 짧고 중립) ─────────────────────────
const MODERATION_FALLBACK_MESSAGE = '이 요청에는 답변할 수 없습니다. 다른 방식으로 질문해 주세요.';

// ─── 감지 함수 ─────────────────────────────────────────────────────────────
async function moderateInput(text) {
  if (!text || typeof text !== 'string') {
    return { blocked: false, reason: 'empty' };
  }

  // 1) Fallback 키워드 먼저 — API 실패에도 동작
  for (const { pattern, category } of FALLBACK_DANGER_PATTERNS) {
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

    if (!res.ok) {
      return { blocked: false, failOpen: true, error: `http_${res.status}` };
    }

    const data = await res.json();
    const result = data?.results?.[0];
    if (!result) {
      return { blocked: false, failOpen: true, error: 'no_result' };
    }

    const categories = result.categories || {};
    for (const cat of BLOCKED_CATEGORIES) {
      if (categories[cat]) {
        return { blocked: true, category: cat, source: 'moderation', flagged: !!result.flagged };
      }
    }

    return { blocked: false, flagged: !!result.flagged };
  } catch (e) {
    return { blocked: false, failOpen: true, error: e.message };
  }
}

module.exports = {
  moderateInput,
  MODERATION_FALLBACK_MESSAGE,
  HARD_BLOCK_CATEGORIES,
  SOFT_BLOCK_CATEGORIES,
  BLOCKED_CATEGORIES,
};
