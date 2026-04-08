// topicFilter.js — 유저 입력이 오늘 뉴스 주제와 관련 있는지 판단
const TOPIC = { ON: 'ON_TOPIC', OFF: 'OFF_TOPIC' };

/**
 * 유저 입력과 뉴스 제목을 비교해 ON_TOPIC / OFF_TOPIC 반환.
 * 짧은 응답(10자 이하)은 항상 ON_TOPIC으로 처리 (공감, 단답 허용).
 * @param {string} userInput
 * @param {string} newsTitle
 * @returns {'ON_TOPIC'|'OFF_TOPIC'}
 */
function filterTopic(userInput, newsTitle = '') {
  if (!userInput || !newsTitle) return TOPIC.ON;
  const trimmed = userInput.trim();

  // 짧은 단답/공감 응답은 무조건 ON_TOPIC
  if (trimmed.length <= 10) return TOPIC.ON;

  // 뉴스 제목에서 의미 있는 키워드 추출 (2글자 이상)
  const keywords = newsTitle
    .replace(/[^\w\s가-힣]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);

  const inputLower = trimmed.toLowerCase();
  const hasMatch = keywords.some(kw => inputLower.includes(kw.toLowerCase()));

  return hasMatch ? TOPIC.ON : TOPIC.OFF;
}

module.exports = { filterTopic, TOPIC };
