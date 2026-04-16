'use strict';

const { getTriggerWord } = require('./services/characterMap');

// ── SD 프롬프트 빌더: situation ────────────────────────────────────────────────
// imageType === 'situation' 전용 — GPT 호출 없음
// interpretation: interpretNews() 반환값
function buildSituationPrompt({ emotion, character, interpretation }) {

  const scene =
    emotion === 'positive'
      ? interpretation.positive_scene
      : interpretation.negative_scene;

  const triggerWord = getTriggerWord(character);

  return `
${interpretation.visual_key},

main action: ${scene.actions},
clear visible reaction happening in the scene,

people reacting clearly (celebrating, cheering, panicking, or discussing),

location: ${interpretation.location},

crowd activity: ${interpretation.actors},
busy environment, multiple people, active scene,

visual details: ${scene.details},
financial charts and market movement visible on screens,

one girl only, no duplicate characters, only one main character,

${triggerWord} present as part of the scene, not the focus,
blending naturally into the environment,

medium shot, balanced composition,
character clearly visible but not dominating the frame,

professional outfit, modest clothing, natural posture,

soft cel-shading, clean lines
`;
}

module.exports = { buildSituationPrompt };
