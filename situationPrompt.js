'use strict';

const { getTriggerWord } = require('./services/characterMap');

// ── SD 프롬프트 빌더: situation ────────────────────────────────────────────────
// imageType === 'situation' 전용 — GPT 호출 없음
// interpretation: interpretNews() 반환값
function buildSituationPrompt({ emotion, character, interpretation }) {

  const scene = emotion === 'positive'
    ? interpretation.positive_view
    : interpretation.negative_view;

  const triggerWord = getTriggerWord(character);

  return `
anime style, cinematic composition, dramatic lighting, expressive atmosphere,

${scene},

${triggerWord} blending into the scene as part of the event, standing out with clear presence, ${emotion === 'positive' ? 'confident posture with slight smile' : 'tense posture with serious expression'},

${interpretation.props},

${emotion === 'positive' ? 'bright lighting, energetic atmosphere' : 'dim lighting, heavy atmosphere'},

wide shot, full scene visible, character clearly visible within the scene
`;
}

module.exports = { buildSituationPrompt };
