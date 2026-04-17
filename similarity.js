'use strict';

// 기사와 history 간 유사도 계산
// 1순위: eventId 완전 일치 → similarity = 1.0
// 2순위: Jaccard similarity on word tokens

function tokenize(text) {
  return text
    .replace(/[^\wㄱ-힣]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);
}

function jaccard(tokensA, tokensB) {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : inter / union;
}

/**
 * 현재 기사와 history 중 가장 유사한 항목의 유사도 및 타임스탬프를 반환
 * @param {object} item      - { title, content }
 * @param {Array}  history   - [{ title, content, timestamp, eventId? }, ...]
 * @param {string} [eventId] - 현재 기사의 eventId (있으면 완전 일치 우선 검사)
 * @returns {{ similarity: number, timestamp: string|null }}
 */
function calcSimilarity(item, history, eventId) {
  if (!history || history.length === 0) {
    return { similarity: 0, timestamp: null };
  }

  // 1순위: eventId 완전 일치
  if (eventId) {
    const match = history.find(h => h.eventId && h.eventId === eventId);
    if (match) {
      return { similarity: 1.0, timestamp: match.timestamp || null };
    }
  }

  // 2순위: Jaccard similarity
  const tokensA = tokenize(item.title + ' ' + (item.content || '').slice(0, 500));
  let maxSim = 0;
  let maxTimestamp = null;

  for (const h of history) {
    const tokensB = tokenize((h.title || '') + ' ' + (h.content || '').slice(0, 500));
    const sim = jaccard(tokensA, tokensB);
    if (sim > maxSim) {
      maxSim = sim;
      maxTimestamp = h.timestamp || null;
    }
  }

  return { similarity: maxSim, timestamp: maxTimestamp };
}

module.exports = { calcSimilarity };
