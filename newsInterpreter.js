/**
 * newsInterpreter.js
 *
 * News Interpreter Agent — 뉴스 제목 → 시각적 장면 JSON (GPT 1회)
 * 반환 구조: { event_core, location, actors, negative_scene, positive_scene, after_reactions }
 *
 * 사용:
 *   const { interpretNews } = require('./newsInterpreter');
 */

'use strict';

// ── GPT 호출 헬퍼 ──────────────────────────────────────────────────────────────
async function callGPT(systemMsg, userMsg, maxTokens = 150) {
  const key = (process.env.OPENAI_API_KEY || '').replace(/['"]/g, '').trim();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user',   content: userMsg   },
      ],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error('GPT 오류: ' + data.error.message);
  return data.choices[0].message.content.trim();
}

// ── JSON 파서 (GPT 마크다운 코드블록 대응) ────────────────────────────────────
function safeJsonParse(raw) {
  try {
    const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('JSON 파싱 실패:', raw);
    throw e;
  }
}

// ── News Interpreter Agent ────────────────────────────────────────────────────
async function interpretNews({ category, newsTitle }) {
  const systemMsg = `You are a visual news interpreter for an image generation system.

Your job is to convert a news headline into a SPECIFIC VISUAL SCENE.

CRITICAL RULES:
- The scene MUST be directly based on the headline
- DO NOT create a generic category-based scene
- Focus on what is physically happening right now
- Show clear human actions (not abstract concepts)
- The scene must be something that can be directly illustrated in a single frame

OUTPUT FORMAT (JSON ONLY):

{
  "event_core": "...",
  "visual_key": "...",
  "location": "...",
  "actors": "...",
  "negative_scene": {
    "actions": "...",
    "details": "..."
  },
  "positive_scene": {
    "actions": "...",
    "details": "..."
  },
  "outcome": {
    "positive": "...",
    "negative": "...",
    "unsure": "..."
  },
  "after_reactions": {
    "positive": {
      "action": "...",
      "context": "..."
    },
    "negative": {
      "action": "...",
      "context": "..."
    },
    "unsure": {
      "action": "...",
      "context": "..."
    }
  }
}

GUIDELINES:
- negative_scene = problem unfolding
- positive_scene = recovery, adaptation, or partial improvement
- BOTH must come from the SAME event

FIELD: visual_key
- A SINGLE visual element that MUST appear in the image
- Represents the core of the news visually
- GOOD: "stock index chart breaking above resistance", "crowded job fair line"
- BAD: abstract concepts, non-drawable ideas
- Must be specific and drawable

FIELD: outcome
- The REAL-WORLD CONSEQUENCE of the news — NOT emotion, NOT reaction
- What materially changed in someone's life because of this event
- GOOD: "increased personal wealth", "financial loss", "missed investment opportunity"
- BAD: "felt happy", "was stressed"

AFTER RULES (CRITICAL):
- AFTER must be based on OUTCOME, not just emotion
- Show how a person's life changes because of the event
- The scene must depict a RESULT of the news, not just reacting to it

FIELD: after_reactions.action
- MUST be a concrete, visible, physical behavior
- Must involve interaction with objects or environment
- GOOD: "counting money on a desk", "checking bank account on a phone", "packing luggage for a trip"
- BAD: "thinking", "looking at a screen", "reacting emotionally", "sitting and thinking"

FIELD: after_reactions.context
- Must show the RESULT environment — not just where, but what changed
- GOOD: "desk covered with cash and financial documents", "luxury hotel room after successful investment"
- BAD: "office", "room", vague locations

EMOTION DEFINITIONS:
- positive: outcome was beneficial — life improved
- negative: outcome was harmful — life got harder
- unsure: outcome is unclear — person is waiting or avoiding

IMPORTANT:
- AFTER scenes must show CONSEQUENCE, not reaction
- Every AFTER image should answer: "What happened to this person because of this news?"
- Positive MUST still be realistic (no exaggerated wealth or fantasy)
- ALL fields must be in English

Return ONLY JSON.`;

  const userMsg = `Category: ${category}\nNews: ${newsTitle}`;
  const raw = await callGPT(systemMsg, userMsg, 400);
  return safeJsonParse(raw);
}

module.exports = { interpretNews };
