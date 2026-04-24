// 선거 기간 정치 콘텐츠 차단 스위치.
// ENV ELECTION_MODE=true 면 뉴스 선정 단계와 /chat 단계에서 정치 콘텐츠를 막는다.
// 공직선거법·AI 기본법상 선거 기간 편향 발언 리스크 차단 목적. Tier 2 #10 이행.
//
// 설계:
// - ENV 플래그 하나로 on/off. 크론으로 선거일 D-30 자동 토글하려면 이 값을 갱신하는
//   별도 스크립트를 Railway cron 에 추가하면 됨 (현 PR 스코프 밖).
// - 키워드는 뉴스 카테고리(process-news.js CATEGORIES 정치)와 동일 + 선거 전용 보강.
// - 개별 정치인 이름은 포함하지 않음: (a) 신구 교체·해외 인물로 유지비 큼,
//   (b) 역할/직책 키워드만으로 선거·정치 담화는 충분히 잡힘.

const POLITICAL_KEYWORDS = [
  // 선거 직접 관련
  '선거', '투표', '개표', '출마', '후보', '당선', '낙선', '경선', '공천',
  '유세', '득표', '여론조사', '지지율',
  // 정부·국회 기관/직책
  '대통령', '총리', '장관', '국회', '국회의원', '의원',
  '청와대', '용산', '국무회의', '국정감사',
  // 정당·정파
  '여당', '야당', '정당', '당대표', '원내대표', '최고위원',
  '민주당', '국민의힘', '정의당', '조국혁신당', '개혁신당', '진보당',
  // 주요 정치 이슈
  '탄핵', '법안', '개헌', '특검', '내각',
];

function isElectionMode() {
  const raw = (process.env.ELECTION_MODE || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on';
}

/**
 * 텍스트에서 정치 키워드 감지. 첫 매치만 반환 (로그 경량화).
 * @param {string} text
 * @returns {{ detected: boolean, matched: string | null }}
 */
function detectPoliticalContent(text) {
  if (!text || typeof text !== 'string') return { detected: false, matched: null };
  for (const kw of POLITICAL_KEYWORDS) {
    if (text.includes(kw)) return { detected: true, matched: kw };
  }
  return { detected: false, matched: null };
}

/**
 * 뉴스 후보에서 정치 카테고리 제외. ELECTION_MODE off 면 원본 그대로 반환.
 * tag 가 "오늘의 픽 · 정치" 인 아이템 + 제목/본문에 정치 키워드가 밀집한 아이템을 제외.
 * process-news.js 에서 pickPool 생성 직후 호출.
 */
function filterOutPolitics(items) {
  if (!isElectionMode()) return items;
  return items.filter(item => {
    const text = `${item.title || ''} ${item.content || ''}`;
    // 키워드 2개 이상 매치면 정치 비중 높다고 판단. 1개만 스치는 건 허용(경제 뉴스에 '법안'
    // 하나 나오는 정도는 통과). 기준은 운영 로그 보고 조정.
    let hits = 0;
    for (const kw of POLITICAL_KEYWORDS) {
      if (text.includes(kw)) hits++;
      if (hits >= 2) return false;
    }
    return true;
  });
}

const ELECTION_BLOCK_MESSAGE = '선거 기간 동안 해당 주제에 대한 응답은 제한됩니다.';

module.exports = {
  isElectionMode,
  detectPoliticalContent,
  filterOutPolitics,
  POLITICAL_KEYWORDS,
  ELECTION_BLOCK_MESSAGE,
};
