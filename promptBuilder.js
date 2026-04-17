'use strict';

const { buildSituationPrompt } = require('./situationPrompt');
const { buildAfterPrompt }     = require('./afterPrompt');

function buildImagePrompt({ emotion, character, imageType, interpretation }) {

  // ── 1. Required field validation ─────────────────────────────
  if (!interpretation) {
    throw new Error('buildImagePrompt: interpretation is missing');
  }

  if (!emotion) {
    throw new Error('buildImagePrompt: emotion is missing');
  }

  if (!imageType) {
    throw new Error('buildImagePrompt: imageType is missing');
  }

  // ── 2. interpretation structure validation ───────────────────
  if (
    !interpretation.positive_view ||
    !interpretation.negative_view ||
    !interpretation.after_positive ||
    !interpretation.after_negative ||
    !interpretation.after_unsure
  ) {
    throw new Error('invalid interpretation (9-field schema)');
  }

  // ── 3. emotion validation (strict) ───────────────────────────
  const validEmotions = ['positive', 'negative', 'unsure'];
  if (!validEmotions.includes(emotion)) {
    throw new Error(`buildImagePrompt: invalid emotion (${emotion})`);
  }

  // ── 4. strict routing (NO fallback) ──────────────────────────
  if (imageType === 'situation') {
    return buildSituationPrompt({ emotion, character, interpretation });
  }

  if (imageType === 'after') {
    return buildAfterPrompt({ emotion, character, interpretation });
  }

  // ── 5. unknown type guard ────────────────────────────────────
  throw new Error(`buildImagePrompt: unknown imageType (${imageType})`);
}

module.exports = { buildImagePrompt };
