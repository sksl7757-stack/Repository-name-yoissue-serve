// trend.mainMood / mainTopic 기반 동적 가중치 산출
const HIGH_IMPACT_MOODS = ['긴장', '위기', '불안', '공포', '충격', '혼란', '경고', '비상', '분노', '위험'];
const HIGH_IMPACT_TOPICS = ['전쟁', '재난', '폭락', '붕괴', '파산', '사망', '테러', '금융위기', '긴급'];

function resolveWeights(trend) {
  const mood  = (trend?.mainMood  || '').trim();
  const topic = (trend?.mainTopic || '').trim();

  const isHighImpact =
    HIGH_IMPACT_MOODS.some(k => mood.includes(k)) ||
    HIGH_IMPACT_TOPICS.some(k => topic.includes(k));

  return isHighImpact
    ? { wImpact: 0.7, wRepresent: 0.3, label: '고위기 모드' }
    : { wImpact: 0.6, wRepresent: 0.4, label: '일반 모드' };
}

function combineScore(impactScore, representScore, trend) {
  const { wImpact, wRepresent } = resolveWeights(trend);
  return impactScore * wImpact + representScore * wRepresent;
}

module.exports = { combineScore, resolveWeights };
