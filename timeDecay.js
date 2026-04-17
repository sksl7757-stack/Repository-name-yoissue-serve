'use strict';

// 시간에 따른 diversity 완화 계산
// 동일 이슈가 선택된 지 오래될수록 다시 선택될 수 있도록 완화

/**
 * @param {number}      nowMs            - Date.now()
 * @param {string|null} historyTimestamp - 가장 유사한 history 항목의 ISO 타임스탬프
 * @returns {number} 0 ~ 1  (0 = 최근, 1 = 오래됨 / 이력 없음)
 */
function calcTimeDecay(nowMs, historyTimestamp) {
  if (!historyTimestamp) return 1;

  const diffHours = (nowMs - new Date(historyTimestamp).getTime()) / (1000 * 3600);

  if (diffHours < 6)  return 0;
  if (diffHours < 24) return 0.3;
  if (diffHours < 72) return 0.6;
  return 1;
}

module.exports = { calcTimeDecay };
