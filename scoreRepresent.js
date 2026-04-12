// 트렌드 대표성 점수
// trend.mainKeyword / mainTopic 과 뉴스의 일치도를 측정

function scoreRepresent(item, trend) {
  const title   = item.title;
  const content = item.content || '';
  const keyword = trend.mainKeyword;

  // mainTopic 에서 의미 있는 단어만 추출 (2자 이상)
  const topicWords = trend.mainTopic
    .split(/[\s,·。.!?]+/)
    .filter(w => w.length >= 2);

  let score = 0;

  // mainKeyword 포함 여부 (제목 > 본문)
  if (title.includes(keyword))        score += 4;
  else if (content.includes(keyword)) score += 2;

  // mainTopic 핵심어 제목 포함 여부 (최대 +3)
  const topicHits = topicWords.filter(w => title.includes(w)).length;
  score += Math.min(topicHits, 3);

  return score;
}

module.exports = { scoreRepresent };
