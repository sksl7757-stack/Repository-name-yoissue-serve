'use strict';

// 트렌드 대표성 점수
// "이 기사가 전체 뉴스 흐름 중 어떤 topic에 속하는지 판단하고,
//  그 topic의 중요도(weight)를 반환한다"

/**
 * @param {object} item     - { title, content }
 * @param {object} analysis - analyzeTrend() 반환값 { topics: [{ name, keywords, weight }], ... }
 * @returns {number} 0 ~ 1
 */
function scoreRepresent(item, analysis) {
  const text   = item.title + ' ' + (item.content || '').slice(0, 500);
  const topics = analysis.topics || [];

  if (topics.length === 0) return 0;

  // STEP 1~2. topic별 매칭 키워드 수 계산
  const scored = topics.map(topic => ({
    topic,
    matchCount: (topic.keywords || []).filter(kw => text.includes(kw)).length,
  }));

  // STEP 3. 매칭 없는 topic 제외 → 매칭 수 내림차순 → 동률 시 weight 내림차순
  const matched = scored
    .filter(s => s.matchCount > 0)
    .sort((a, b) =>
      b.matchCount - a.matchCount || b.topic.weight - a.topic.weight
    );

  // 예외: 매칭 없음
  if (matched.length === 0) return 0;

  // STEP 4. 최고 매칭 topic의 weight 사용
  const best = matched[0];
  let represent = best.topic.weight;

  // STEP 4 보너스: 매칭 수에 따른 가산
  if (best.matchCount >= 3) represent += 0.10;
  else if (best.matchCount >= 2) represent += 0.05;

  return Math.min(represent, 1.0);
}

module.exports = { scoreRepresent };
