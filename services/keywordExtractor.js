'use strict';

// 기사 텍스트에서 대표 키워드 추출
// GPT·품사 분석 없이 단순 빈도 기반으로 처리

// ─── 불용어 ───────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  // 조사 / 접속사 (분리된 경우)
  '은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '로', '도', '만',
  '서', '까지', '부터', '에게', '한테', '이나', '거나', '하고', '이고',
  // 뉴스 일반 단어
  '기자', '사진', '뉴스', '속보', '단독', '제공', '연합뉴스', '뉴시스', '뉴스1',
  // 의미 없는 단어
  '관련', '통해', '위해', '대한', '이번', '지난', '오늘', '내일', '현재', '최근',
  '따르면', '밝혔다', '말했다', '전했다', '했다', '있다', '없다', '됐다', '됩니다',
  '이후', '이전', '등', '및', '또', '또는', '그리고', '하지만', '그러나', '때문',
  '방문해', '강화할', '커질', '전망', '부담', '대폭', '발표했다', '말했다',
  '밝혔다', '전했다', '했다', '있다', '없다', '됐다', '됩니다', '한다고',
]);

// ─── 한국어 조사 (길이 내림차순 — 긴 것부터 매칭해야 잘못 잘리지 않음) ────────

const KO_PARTICLES = [
  '에서는', '에서도', '에서의', '에서',
  '이라는', '이라고', '이라도', '이라면', '이라서',
  '라는', '라고', '라도', '라면', '라서',
  '부터는', '부터도', '부터', '까지는', '까지도', '까지',
  '에게는', '에게도', '에게', '한테는', '한테도', '한테',
  '으로는', '으로도', '으로서', '으로',
  '로는', '로도', '로서',
  '에는', '에도', '에서', '에',
  '과는', '과도', '와는', '와도',
  '이고', '이며', '이나', '이거나', '이다',
  '는데', '하고', '하며', '한다고', '했다고',
  '이었다', '됐다', '됩니다',
  '에서', '과', '와',
  '는', '은', '가', '이', '을', '를', '의', '도', '만', '서',
].sort((a, b) => b.length - a.length); // 긴 것 우선

// ─── 조사 제거 ────────────────────────────────────────────────────────────────

function stripParticle(word) {
  // 영문·숫자 혼합이면 그대로
  if (/[a-zA-Z]/.test(word)) return word;
  let prev;
  do {
    prev = word;
    for (const p of KO_PARTICLES) {
      if (word.length > p.length + 1 && word.endsWith(p)) {
        word = word.slice(0, word.length - p.length);
        break;
      }
    }
  } while (word !== prev); // 더 이상 제거할 조사 없을 때까지 반복
  return word;
}

// ─── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 기사에서 대표 키워드를 추출한다
 * @param {object} article - { title: string, content: string }
 * @returns {string[]} 상위 5~10개 키워드 배열
 */
function extractKeywords(article) {
  const title   = article.title   || '';
  const content = (article.content || '').slice(0, 300);

  // STEP 1. 원문 토큰 → 원형(대소문자) 보존 맵 구성 (title 기준)
  // 영문 대문자 단어("AI", "IMF")를 소문자 키로 역참조
  const originalMap = new Map(); // lowercase → original
  for (const w of title.split(/\s+/)) {
    const clean = w.replace(/[^\wㄱ-힣]/g, '');
    if (clean.length >= 2) originalMap.set(clean.toLowerCase(), clean);
  }

  // STEP 2. 전체 텍스트 결합 (title 2회 → 가중치 2배)
  const combined = title + ' ' + title + ' ' + content;

  // STEP 3. 전처리: 특수문자·숫자 제거 → 분리
  const tokens = combined
    .replace(/[0-9]+/g, ' ')
    .replace(/[^\wㄱ-힣\s]/g, ' ')
    .split(/\s+/)
    .map(w => stripParticle(w))        // 조사 제거
    .filter(w => w.length >= 2 && w.length < 15);

  // STEP 4. 불용어 제거 + 빈도 계산 (소문자 키)
  const freq = new Map();
  for (const word of tokens) {
    const key = word.toLowerCase();
    if (STOPWORDS.has(key) || STOPWORDS.has(word)) continue;
    freq.set(key, (freq.get(key) || 0) + 1);
  }

  // STEP 5. 빈도 내림차순 정렬 → 원형 복원 → 중복 제거 → 상위 10개
  const result = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => originalMap.get(key) || key) // 원형 복원 (없으면 lowercase 그대로)
    .filter((w, i, arr) => arr.indexOf(w) === i)  // 중복 제거
    .slice(0, 10);

  return result;
}

module.exports = { extractKeywords };
