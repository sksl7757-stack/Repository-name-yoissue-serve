'use strict';

const { getTriggerWord } = require('./services/characterMap');

// ── SD 프롬프트 빌더: after ───────────────────────────────────────────────────
// imageType === 'after' 전용 — GPT 호출 없음
// interpretation: interpretNews() 반환값
function buildAfterPrompt({ emotion, character, interpretation }) {

  const anchor = {
    positive: interpretation.after_positive,
    negative: interpretation.after_negative,
    unsure:   interpretation.after_unsure,
  }[emotion] || interpretation.after_unsure;

  const triggerWord = getTriggerWord(character);

  return `
anime style, cinematic composition, dramatic lighting, expressive atmosphere,

${anchor},

${triggerWord} ${emotion === 'positive' ? 'with satisfied expression, enjoying the moment' : emotion === 'negative' ? 'with distressed expression, absorbed in the situation' : 'looking disengaged, detached from reality'},

medium shot, scene dominates composition
`;
}

module.exports = { buildAfterPrompt };
