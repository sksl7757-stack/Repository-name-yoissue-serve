'use strict';

const { getTriggerWord } = require('./services/characterMap');

// ── SD 프롬프트 빌더: after ───────────────────────────────────────────────────
// imageType === 'after' 전용 — GPT 호출 없음
// interpretation: interpretNews() 반환값
function buildAfterPrompt({ emotion, character, interpretation }) {

  const reactions = interpretation.after_reactions || {};
  const outcomes  = interpretation.outcome || {};

  const reaction =
    reactions[emotion] ||
    reactions.unsure ||
    reactions.negative || {
      action:  'sitting quietly',
      context: 'in a plain room',
    };

  const outcome = outcomes[emotion] || outcomes.unsure || interpretation.event_core;

  const triggerWord = getTriggerWord(character);

  return `
main personal action: ${reaction.action},
clear physical behavior, visible interaction with objects or environment,

consequence of the news: ${outcome},

location: ${reaction.context},

quiet environment, private setting, no crowd, no group activity,

news consequence visible through environment: ${interpretation.visual_key || interpretation.event_core},

one girl only, solo, single character, no duplicate characters,

${triggerWord} as the only subject, centered in the frame,

medium shot, clean composition,
character clearly visible and dominant in the scene,

natural posture, calm or subtle emotional expression,

professional outfit, modest clothing,

soft cel-shading, clean lines
`;
}

module.exports = { buildAfterPrompt };
