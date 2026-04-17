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
      response_format: { type: 'json_object' },
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
async function interpretNews({ category, newsTitle, newsSummary = '' }) {
  const systemMsg = `You are a visual scene generator for FLUX image generation model.
Convert a news headline into 9 drawable visual fields.

PRIORITY RULES (in strict order):

1. CATEGORY MOOD (mandatory - cannot be changed)
   Every scene MUST carry the visual mood of its category.
   - IT → tech office feel, monitors, code screens, blue-tone lighting, developer workspace
   - Finance → financial workplace feel, charts, market data, trading atmosphere
   - Politics → political setting feel, formal atmosphere, official scenery
   - Real estate → property-related feel, interiors, contracts, keys
   - Health → clinical/medical feel, sterile environment
   - Culture → artistic feel, creative spaces
   - Environment → nature or industrial impact feel
   - International → global/foreign feel
   - Social → everyday life feel

2. NEWS DETAILS (only visually drawable elements)
   Extract key concepts from the news and translate them into VISUAL SYMBOLS.
   - NEVER include text/letters/document content (AI cannot render readable text)
   - Convert abstract concepts into concrete visual symbols:
     * "AI" → glowing neural network visualization, digital brain graphics
     * "quantum security" → complex circuit boards, lock icons on screens
     * "stock crash" → red downward graphs, falling arrows
     * "launch cancelled" → dimmed presentation screen, closed curtain
     * "hacking" → warning red alerts, broken lock symbol

3. ACTIONS
   Describe what people are physically doing in this mood + context.

OUTPUT FORMAT (JSON ONLY):

{
  "news_core": "...",
  "is_mourning_required": true_or_false,
  "location": "...",
  "actors": "...",
  "props": "...",
  "positive_view": "...",
  "negative_view": "...",
  "after_positive": "...",
  "after_negative": "...",
  "after_unsure": "..."
}

---

FIELD DEFINITIONS:

news_core — one-sentence summary of the news event

is_mourning_required — boolean
Answer: "Would generating a positive/celebratory image of this news hurt victims, families, or survivors?"
- true: news about deaths, disasters, accidents, tragedies, memorials, terror attacks, mass casualties, mourning events
- false: political news, economic news, business news, normal events
Examples:
  "세월호 참사 12주기" → true
  "이태원 참사 추모식" → true
  "교통사고 사망자 5명" → true
  "대학교수 별세" → true
  "독재자 사망" → false
  "연쇄살인범 검거" → false
  "삼성전자 주가 폭락" → false
  "대통령 탄핵 가결" → false
GOOD: "KOSPI index broke above 6200 for the first time after Iran war fears eased"

location — brief background setting (subordinate to action)
- Keep it simple, just 1-3 words
- The scene is about ACTIONS, not the place
GOOD: "modern office interior", "meeting room", "home office"
BAD: "stock exchange trading floor with detailed monitors and bustling crowd"

actors — people physically present in the scene
GOOD: "suited traders at monitors", "hard-hatted construction workers", "protesters holding signs"
BAD: "investors", "people", "the public"

props — 3-5 physical objects that reinforce the event (NOT people, NOT location)
GOOD: "scattered financial papers, flashing red ticker boards, overturned coffee cups"
BAD: "nice office", "modern building", "busy environment"

positive_view — visual interpretation of this news scene with a POSITIVE tone
- Visualize the news EVENT itself, not a person reading news
- Interpret the event in a positive/hopeful light
- Follow the 3 priority rules (category mood > news visual symbols > actions)
- Don't fix the scene scope - let the news content guide whether it's one person or many, on-site or elsewhere

STRUCTURE:
[category mood] + [visual symbols representing news content] + [DRAMATIC actions - intense body language like celebrating loudly, rushing with excitement, bursts of reactions - NOT just "discussing" or "looking"] + [bright/hopeful atmosphere with heightened energy]

ADDITIONAL RULE: Avoid passive verbs like "watching", "looking at", "discussing", "brainstorming". Use intense action verbs like "shouting", "rushing", "grabbing", "pointing excitedly", "leaping up".

BAD: "person feeling happy", "people celebrating"

negative_view — visual interpretation of this news scene with a NEGATIVE tone
- Visualize the news EVENT itself, not a person reading news
- Interpret the event in a negative/concerning light
- Follow the 3 priority rules (category mood > news visual symbols > actions)
- Don't fix the scene scope - let the news content guide whether it's one person or many, on-site or elsewhere
- Must be visually OPPOSITE to positive_view

STRUCTURE:
[category mood] + [visual symbols representing news content] + [DRAMATIC actions - intense body language like gripping head, slamming desk, stepping back in shock, frozen in disbelief - NOT just "worried" or "concerned"] + [dim/heavy atmosphere with heightened tension]

ADDITIONAL RULE: Avoid passive verbs like "watching", "glancing", "discussing", "reviewing". Use intense action verbs like "slamming", "gripping", "clutching", "staggering", "freezing".

BAD: "person feeling sad", "people looking worried"

after_positive — the MAIN CHARACTER's personal experience as a positive impact from this news
- The character is the center of the scene
- Show how this news positively affected the character's personal life
- Keep the CATEGORY MOOD in the background/props
- Location and scene can be flexible (cafe, workspace, event, travel, home, etc.)
- MUST include: character action + related props + category mood elements + bright atmosphere
- Use DRAMATIC actions, not passive ones
- Show intense emotion through body language

after_negative — the MAIN CHARACTER's personal experience as a negative impact from this news
- The character is the center of the scene
- Show how this news negatively affected the character's personal life
- Keep the CATEGORY MOOD in the background/props
- Location and scene can be flexible
- MUST include: character action + related props + category mood elements + dim atmosphere
- Use DRAMATIC actions, not passive ones
- Show intense emotion through body language

after_unsure — person completely DISCONNECTED from the news topic
- NOT anxious, NOT worried, NOT nervous — mentally fully escaped
- ZERO visual connection to the news topic
- IGNORE the category mood for this field (escape scene must have ZERO connection to the news topic or category)
- Choose scenarios completely unrelated to the news category
- MUST include ALL 4 elements: action + central object + supporting elements + atmosphere
- Choose from a WIDE variety of escape scenarios — do NOT always pick gaming or sleeping

ESCAPE SCENARIO EXAMPLES (pick the most visually interesting, vary each time):
GOOD gaming: "slouched on couch gripping game controller, eyes locked on glowing TV screen, takeout containers and snack wrappers on coffee table, phone face-down ignored, dim living room with console light blinking"
GOOD sleeping: "buried under thick blanket in dark bedroom, only tuft of hair visible, phone face-down on nightstand, curtains drawn, alarm clock showing afternoon time, completely shut off from world"
GOOD cooking: "standing at kitchen counter intensely following recipe on tablet, chopping vegetables, flour dusted on hands, multiple pots on stove, warm kitchen lighting, completely absorbed in cooking"
GOOD reading: "curled in armchair with thick novel open, hot mug of tea steaming on side table, cat asleep on lap, warm reading lamp, rain visible through window behind, cozy quiet room"
GOOD workout: "doing intense home workout on yoga mat, dumbbells and resistance bands around, sweat visible, fitness app on phone screen, energetic bright room, earbuds in"
GOOD bath: "soaking in bathtub full of bubbles, eyes closed, candles on tub edge, rubber duck floating, bathroom foggy with steam, completely relaxed and isolated"
GOOD art: "hunched over desk drawing in sketchbook, colored pencils scattered, reference photos pinned to board, desk lamp focused on paper, quiet creative space, phone out of reach"
GOOD music: "sitting cross-legged on floor with headphones on, eyes closed, vinyl record spinning on turntable beside, album covers spread around, soft warm light, fully immersed in sound"
GOOD pet: "sitting on floor playing with cat using feather toy, laughing expression, cat toys scattered around, cozy home corner, soft afternoon light through window"
GOOD movie: "under blanket on couch watching TV, popcorn bowl on lap, streaming interface visible on screen, dim room with TV as only light source, fully absorbed"

---

ALL fields must be in English. Return ONLY JSON.`;

  const userMsg = `Category: ${category}\nNews: ${newsTitle}${newsSummary ? `\nDetail: ${newsSummary}` : ''}`;
  const raw = await callGPT(systemMsg, userMsg, 1500);
  return safeJsonParse(raw);
}

module.exports = { interpretNews };
