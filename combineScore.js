'use strict';

// 최종 score 계산
// impact × 0.5 + represent × 0.3 + diversity × 0.2

/**
 * @param {number} impactScore    - scoreImpact() 반환값
 * @param {number} representScore - scoreRepresent() 반환값
 * @param {number} diversity      - (1 - similarity) * timeDecay  (0 ~ 1)
 * @returns {number} finalScore
 */
function combineScore(impactScore, representScore, diversity) {
  return impactScore * 0.5 + representScore * 0.3 + diversity * 0.2;
}

module.exports = { combineScore };
