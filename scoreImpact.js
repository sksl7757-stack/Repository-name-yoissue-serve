// 경제·정책·사회·국제적 영향도 기반 점수
// 일반인 생활에 직접 닿는 이슈일수록 높은 점수

const ECONOMIC = ['경제', '물가', '금리', '주가', '환율', '인플레', '관세', '무역', '수출', '수입', '세금', '재정', '예산', '성장률', 'gdp', '부동산', '집값', '전세'];
const POLICY   = ['정책', '법안', '규제', '국회', '정부', '대통령', '장관', '행정', '입법', '개정', '탄핵', '총선', '개각'];
const SOCIAL   = ['안전', '재난', '사고', '피해', '의료', '복지', '교육', '노동', '주거', '범죄', '참사', '사망'];
const INTERNATIONAL = [
  // 인물
  '트럼프', '푸틴', '시진핑', '바이든',
  // 국가·지역
  '이란', '북한', '러시아', '중국', '미국', '중동', '우크라이나', '이스라엘',
  // 군사/외교
  '전쟁', '핵', '미사일', '제재', '호르무즈', '나토', 'NATO',
];

// 주요 전국 매체 — 가중치 1.0 (지방지/소규모는 0.6)
const MAJOR_SOURCES = [
  // 통신사
  'yna.co.kr', 'yonhapnewstv.co.kr', 'newsis.com', 'news1.kr',
  // 방송
  'ytn.co.kr', 'kbs.co.kr', 'mbc.co.kr', 'sbs.co.kr',
  'jtbc.co.kr', 'tvchosun.com', 'mbn.co.kr', 'channela.co.kr',
  // 일간지
  'chosun.com', 'joins.com', 'joongang.co.kr',
  'donga.com', 'hani.co.kr', 'khan.co.kr',
  'hankookilbo.com', 'kmib.co.kr', 'segye.com', 'munhwa.com',
  // 경제지
  'hankyung.com', 'mk.co.kr', 'sedaily.com',
  'edaily.co.kr', 'mt.co.kr', 'fnnews.com', 'asiae.co.kr',
  // 기타
  'nocutnews.co.kr', 'ohmynews.com', 'pressian.com', 'heraldcorp.com',
];

function getSourceWeight(url) {
  if (!url) return 0.7;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    if (MAJOR_SOURCES.some(d => hostname.includes(d))) return 1.0;
    return 0.6;
  } catch {
    return 0.7;
  }
}

function scoreImpact(item) {
  const text = item.title + ' ' + (item.content || '');
  let score = 0;

  if (ECONOMIC.some(k => text.includes(k)))      score += 2;
  if (POLICY.some(k => text.includes(k)))        score += 1;
  if (SOCIAL.some(k => text.includes(k)))        score += 1;
  if (INTERNATIONAL.some(k => text.includes(k))) score += 2;

  const url = item.url || item.link;
  return score * getSourceWeight(url);
}

module.exports = { scoreImpact };
