// 경제·정책·사회적 영향도 기반 점수
// 일반인 생활에 직접 닿는 이슈일수록 높은 점수

const ECONOMIC = ['경제', '물가', '금리', '주가', '환율', '인플레', '관세', '무역', '수출', '수입', '세금', '재정', '예산', '성장률', 'gdp', '부동산', '집값', '전세'];
const POLICY   = ['정책', '법안', '규제', '국회', '정부', '대통령', '장관', '행정', '입법', '개정'];
const SOCIAL   = ['안전', '재난', '사고', '피해', '의료', '복지', '교육', '노동', '주거', '범죄'];

function scoreImpact(item) {
  const text = item.title + ' ' + (item.content || '');
  let score = 0;

  if (ECONOMIC.some(k => text.includes(k))) score += 2;
  if (POLICY.some(k => text.includes(k)))   score += 1;
  if (SOCIAL.some(k => text.includes(k)))   score += 1;

  return score;
}

module.exports = { scoreImpact };
