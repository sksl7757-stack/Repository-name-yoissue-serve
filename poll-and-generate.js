/**
 * poll-and-generate.js
 *
 * 집 PC에서 계속 실행되는 로컬 스크립트.
 * 5분마다 Supabase daily_news 테이블에서 오늘 뉴스를 확인하고,
 * 누락된 캐릭터 이미지를 ComfyUI(localhost:8188)로 생성해 Supabase Storage에 업로드한다.
 *
 * 이미지 타입:
 *   situation: {날짜}_{charKey}_situation_{emotion}.png  — emotion: positive / worry       (캐릭터당 2장)
 *   after:     {날짜}_{charKey}_after_{emotion}.png      — emotion: positive / negative / worry (캐릭터당 3장)
 * 총 10장 (캐릭터 2명 기준)
 *
 * 캐릭터 목록: CHARACTERS 환경변수로 관리 (기본값 hana,junhyuk)
 *   예) CHARACTERS=hana:하나,junhyuk:준혁,munchi:뭉치
 *
 * 저장 버킷: yoissue-images
 * 사용: node poll-and-generate.js
 */

'use strict';

const { loadEnv } = require('./loadEnv');
loadEnv();

const { createClient } = require('@supabase/supabase-js');
const { buildComfyWorkflow } = require('./comfyUtils');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENAI_KEY   = (process.env.OPENAI_API_KEY || '').replace(/['"]/g, '').trim();
const SD_MODEL     = process.env.SD_MODEL_NAME || 'v1-5-pruned-emaonly.safetensors';

const COMFY_URL    = 'http://localhost:8188';
const BUCKET       = 'yoissue-images';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5분

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── 캐릭터 목록 (환경변수로 관리) ────────────────────────────────────────────────
// CHARACTERS=hana:하나,junhyuk:준혁  (charKey:표시이름 쌍을 쉼표로 구분)
const DEFAULT_CHARACTERS = 'hana:하나,junhyuk:준혁';
const CHARACTERS = (process.env.CHARACTERS || DEFAULT_CHARACTERS)
  .split(',')
  .map(pair => {
    const [charKey, character] = pair.trim().split(':');
    return { charKey, character };
  });

// ── 이미지 조합 생성 ───────────────────────────────────────────────────────────
// situation: positive / negative         (캐릭터당 2장)
// after:     positive / negative / unsure (캐릭터당 3장)
// 총 캐릭터당 5장
const SITUATION_EMOTIONS = ['positive', 'negative'];
const AFTER_EMOTIONS     = ['positive', 'negative', 'unsure'];

const IMAGE_COMBOS = CHARACTERS.flatMap(({ charKey, character }) => [
  ...SITUATION_EMOTIONS.map(emotion => ({ charKey, character, imageType: 'situation', emotion })),
  ...AFTER_EMOTIONS.map(emotion     => ({ charKey, character, imageType: 'after',     emotion })),
]);

// ── 유틸 ────────────────────────────────────────────────────────────────────────
function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// {날짜}/{charKey}/{imageType}/{emotion}/{timestamp}.png
function storagePath(date, charKey, imageType, emotion) {
  return `${date}/${charKey}/${imageType}/${emotion}/${Date.now()}.png`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Supabase: 오늘 뉴스 조회 ────────────────────────────────────────────────────
async function getTodayNews() {
  const { data, error } = await supabase
    .from('daily_news')
    .select('date, title, category')
    .eq('date', today())
    .maybeSingle();
  if (error) throw new Error('daily_news 조회 오류: ' + error.message);
  return data; // null이면 오늘 뉴스 없음
}

// ── GPT 공통 호출 헬퍼 ─────────────────────────────────────────────────────────
async function callGPT(systemMsg, userMsg) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 150,
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

// ── 상황 프롬프트: 뉴스 장면 중심 ──────────────────────────────────────────────
// imageType === 'situation' 전용
// 구조: [뉴스 상황] + [장소] + [사람들 행동] + [전체 분위기] + [캐릭터는 장면의 일원]
const SITUATION_SHOTS = [
  {
    label: 'wide establishing shot',
    rule:  'Compose as a wide establishing shot — show the full environment, multiple figures spread across the frame, and the location clearly readable at a glance.',
  },
  {
    label: 'medium group shot',
    rule:  'Compose as a medium group shot — frame 3–5 people from the waist up, showing faces and interactions, with the location visible in the background.',
  },
  {
    label: 'over-the-shoulder shot',
    rule:  'Compose as an over-the-shoulder shot — the character\'s shoulder and back occupy one side of the frame, with the unfolding scene visible from their viewpoint.',
  },
  {
    label: 'eye-level crowd shot',
    rule:  'Compose at eye level from within the crowd — the character is among other people, all roughly the same scale, giving a feeling of being immersed in the scene.',
  },
];

async function buildSituationPrompt({ category, emotion, character, newsTitle }) {
  const shot = SITUATION_SHOTS[Math.floor(Math.random() * SITUATION_SHOTS.length)];

  const atmosphereGuide =
    emotion === 'positive' ? 'optimistic and energetic — people look relieved, celebrating, or motivated' :
    emotion === 'negative' ? 'tense and somber — people look stressed, worried, or overwhelmed' :
    /* worry */              'uncertain and cautious — people look anxious or unsettled';

  const systemMsg = `You are an AI that writes image generation prompts for a Korean news app.
Write a concise English prompt (under 80 words) for a webtoon/anime-style illustration.

Build the prompt in this exact order:
1. News-derived situation keyword (e.g. "military blockade", "economic downturn", "factory closure")
2. Specific real-world location that fits the news category:
   - 정치/politics: government building exterior, parliament steps, press briefing room, presidential residence
   - 군사/military: naval port, warship deck, military base, operations command center, harbor with warships
   - 국제/international: airport terminal, embassy exterior, international conference hall, border checkpoint
   - 경제/economy: stock exchange floor, bank lobby, office building, commercial district, factory floor
   - 사회/society: hospital corridor, school courtyard, public square, community center
   - 문화/culture: concert venue, museum hall, cultural festival grounds
   - 과학/science: research lab, university campus, tech conference hall
   Pick the ONE location that best fits the news title and category.
3. Multiple people and their visible actions that fit the location (e.g. "soldiers standing at attention", "officers monitoring screens")
4. Overall atmosphere: ${atmosphereGuide}
5. The character (${character}) as ONE small figure in the scene, doing a contextually fitting action

Hard rules:
- ${shot.rule}
- FAR SHOT, ZOOMED OUT — full scene must be visible
- Character occupies a small portion of the frame — face not dominant
- Subject small in frame, surrounded by environment and other people
- NEVER close-up, NEVER portrait, NEVER face-filling-the-frame
- Soft cel-shading, clean outlines, pastel background tones

Return ONLY the prompt text, nothing else.`;

  const userMsg = `News: ${newsTitle}\nCategory: ${category}\nCharacter: ${character}\nEmotion: ${emotion}`;
  const generatedPrompt = await callGPT(systemMsg, userMsg);
  const triggerWord    = character === '하나' ? 'hana' : 'junhyuk';
  const qualityPrefix  = `(masterpiece:1.2), (best quality:1.2), highly detailed, far shot, zoomed out, subject small in frame, full scene visible, ${shot.label}, multiple people, scene-focused, soft cel-shading, `;
  return `${qualityPrefix}${triggerWord}, ${generatedPrompt}`;
}

// ── 감정(after) 프롬프트: 캐릭터 감정 공감 중심 ────────────────────────────────
// imageType === 'after' 전용
// 구조: [캐릭터] + [감정 상태] + [행동] + [간단한 배경]
//
// 감정별 설계 원칙:
//   positive → 안정된 정지 상태 (relaxed posture, gentle smile)
//   negative → 이미 끝난 상태  (exhausted, emotionally drained, no more energy)
//   unsure   → 모르겠음/회피    (avoidant, blank stare, detached — 판단 보류)

const AFTER_EMOTION_PROFILES = {
  positive: {
    state:      'relaxed and settled — gentle smile, soft eyes, upright but comfortable posture',
    actions:    'sitting quietly with a warm drink, leaning back with hands resting, or gazing out a window with a calm expression',
    background: 'bright and cozy — sunlit room, warm cafe, or soft afternoon light',
    shotHint:   'full body visible — far enough to see the entire figure and surrounding space, face NOT dominant',
  },
  negative: {
    state:      'exhausted and emotionally drained — eyes downcast, slumped shoulders, no energy left to react',
    actions:    'slumped on a chair staring at nothing, lying on a bed fully clothed, or sitting on the floor with back against the wall',
    background: 'dim and quiet — dark room with a single lamp, empty hallway, or late-night desk',
    shotHint:   'full body visible — far enough to see collapsed posture and surrounding space, face NOT dominant',
  },
  unsure: {
    state:      'emotionally detached and avoidant — blank expression, neither upset nor happy, deliberately not engaging with the topic',
    actions:    'looking away from the screen, scrolling aimlessly without reading, or sitting with arms crossed staring into empty space',
    background: 'neutral and unremarkable — plain room, ordinary desk, or featureless background that offers no distraction',
    shotHint:   'full body visible — far enough to see the avoidant posture and surrounding space, face NOT dominant',
  },
};

async function buildAfterPrompt({ emotion, character, newsTitle }) {
  const profile = AFTER_EMOTION_PROFILES[emotion] || AFTER_EMOTION_PROFILES.unsure;

  const systemMsg = `You are an AI that writes image generation prompts for a Korean news app.
Write a concise English prompt (under 80 words) for a webtoon/anime-style illustration.

Build the prompt in this exact order:
1. The character (${character}) as the sole subject
2. Emotional state: ${profile.state}
3. Specific action: choose ONE from — ${profile.actions}
4. Background: ${profile.background}

Hard rules:
- ${profile.shotHint}
- FAR SHOT, ZOOMED OUT — full body and surrounding space must be visible
- Character occupies a small portion of the frame — face not dominant
- Emotion readable from body language and posture, NOT from facial close-up
- ONE character only — NO multiple people
- NEVER close-up, NEVER portrait, NEVER face-filling-the-frame
- Soft cel-shading, clean outlines, pastel tones

Return ONLY the prompt text, nothing else.`;

  const userMsg = `Character: ${character}\nEmotion: ${emotion}\nNews context: ${newsTitle}`;
  const generatedPrompt = await callGPT(systemMsg, userMsg);
  const triggerWord    = character === '하나' ? 'hana' : 'junhyuk';
  const qualityPrefix  = '(masterpiece:1.2), (best quality:1.2), highly detailed, far shot, zoomed out, full body visible, subject small in frame, face not dominant, single character, emotion-focused, soft cel-shading, ';
  return `${qualityPrefix}${triggerWord}, ${generatedPrompt}`;
}

// ── 이미지 타입에 따라 적절한 프롬프트 함수 호출 ────────────────────────────────
async function buildImagePrompt({ category, emotion, character, imageType, newsTitle }) {
  if (imageType === 'situation') {
    return buildSituationPrompt({ category, emotion, character, newsTitle });
  } else {
    return buildAfterPrompt({ emotion, character, newsTitle });
  }
}

// ── ComfyUI: /history 폴링 ──────────────────────────────────────────────────────
async function pollComfyHistory(promptId, maxWaitMs = 180000) {
  const interval = 3000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await sleep(interval);
    const res  = await fetch(`${COMFY_URL}/history/${promptId}`);
    const data = await res.json();
    const entry = data[promptId];
    if (!entry) continue;

    const outputs = entry.outputs || {};
    for (const nodeId of Object.keys(outputs)) {
      const images = outputs[nodeId]?.images;
      if (images?.length) return images[0]; // { filename, subfolder, type }
    }
  }
  throw new Error('ComfyUI 이미지 생성 타임아웃 (3분 초과)');
}

// ── 단일 이미지 생성 + 업로드 ──────────────────────────────────────────────────
async function generateAndUpload({ date, category, newsTitle, combo }) {
  const label = `${combo.charKey}_${combo.imageType}_${combo.emotion}`;
  console.log(`  [GEN]  ${label}`);

  // 2. GPT로 프롬프트 생성
  const imagePrompt = await buildImagePrompt({
    category,
    emotion:   combo.emotion,
    character: combo.character,
    imageType: combo.imageType,
    newsTitle,
  });
  console.log(`         prompt: ${imagePrompt.slice(0, 60)}...`);

  // 3. ComfyUI에 워크플로 전송
  const loraName  = combo.charKey === 'hana' ? 'hana.safetensors' : null;
  const workflow  = buildComfyWorkflow(imagePrompt, SD_MODEL, loraName);
  const queueRes  = await fetch(`${COMFY_URL}/prompt`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ prompt: workflow }),
  });
  const queueData = await queueRes.json();
  const promptId  = queueData.prompt_id;
  if (!promptId) throw new Error('ComfyUI prompt_id 없음: ' + JSON.stringify(queueData));

  // 4. /history 폴링 → 완성된 이미지 정보 획득
  const imageInfo = await pollComfyHistory(promptId);

  // 5. /view 로 이미지 바이너리 가져오기
  const viewUrl = `${COMFY_URL}/view?filename=${encodeURIComponent(imageInfo.filename)}&subfolder=${encodeURIComponent(imageInfo.subfolder || '')}&type=${imageInfo.type || 'output'}`;
  const imgRes  = await fetch(viewUrl);
  if (!imgRes.ok) throw new Error(`ComfyUI /view 실패: ${imgRes.status}`);
  const buffer  = Buffer.from(await imgRes.arrayBuffer());

  // 6. Supabase Storage 업로드 (유니크 타임스탬프 경로)
  const filePath = storagePath(date, combo.charKey, combo.imageType, combo.emotion);
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, buffer, { contentType: 'image/png', upsert: false, cacheControl: '3600' });
  if (uploadError) throw new Error('Storage 업로드 오류: ' + uploadError.message);

  console.log(`         → 업로드 완료: ${filePath}`);
  return { label, filePath, status: 'generated' };
}

// ── 메인 폴 루프 ────────────────────────────────────────────────────────────────
async function runOnce() {
  const date = today();
  console.log(`\n[${new Date().toLocaleTimeString('ko-KR')}] 폴링 시작 — ${date}`);

  // 1. 오늘 뉴스 확인
  let news;
  try {
    news = await getTodayNews();
  } catch (e) {
    console.error('  뉴스 조회 실패:', e.message);
    return;
  }

  if (!news) {
    console.log('  오늘 뉴스 없음 — 스킵');
    return;
  }

  console.log(`  뉴스: [${news.category}] ${news.title.slice(0, 40)}...`);

  // 2. 오늘 이미지 이미 생성됐는지 확인
  const { data: existing } = await supabase
    .from('daily_news')
    .select('image_paths')
    .eq('date', date)
    .maybeSingle();

  if (existing?.image_paths?.length >= IMAGE_COMBOS.length) {
    console.log(`  이미지 이미 생성됨 (${existing.image_paths.length}장) — 스킵`);
    return;
  }

  // 3. 각 조합에 대해 이미지 생성/업로드
  const results = [];
  for (const combo of IMAGE_COMBOS) {
    try {
      const result = await generateAndUpload({
        date,
        category:  news.category,
        newsTitle: news.title,
        combo,
      });
      results.push(result);
    } catch (e) {
      const label = `${combo.charKey}_${combo.emotion}`;
      console.error(`  [ERR]  ${label}: ${e.message}`);
      results.push({ label, status: 'error', error: e.message });
    }
  }

  // 3. 결과 요약
  const generated = results.filter(r => r.status === 'generated').length;
  const skipped   = results.filter(r => r.status === 'skipped').length;
  const errors    = results.filter(r => r.status === 'error').length;
  console.log(`  완료 — 생성: ${generated}개 / 스킵: ${skipped}개 / 오류: ${errors}개`);

  // 4. 생성된 image_path 목록을 daily_news에 저장
  const imagePaths = results.filter(r => r.status === 'generated' && r.filePath).map(r => r.filePath);
  if (imagePaths.length > 0) {
    const { error: updateError } = await supabase.from('daily_news')
      .update({ image_paths: imagePaths })
      .eq('date', date);
    if (updateError) console.error('  image_paths 저장 실패:', updateError.message);
    else console.log(`  image_paths 저장 완료 (${imagePaths.length}개)`);
  }
}

async function main() {
  console.log('=== poll-and-generate 시작 ===');
  console.log(`  ComfyUI: ${COMFY_URL}`);
  console.log(`  Supabase 버킷: ${BUCKET}`);
  console.log(`  캐릭터: ${CHARACTERS.map(c => `${c.charKey}(${c.character})`).join(', ')}`);
  console.log(`  이미지 조합: 총 ${IMAGE_COMBOS.length}개 (캐릭터당 situation×2 + after×3)`);
  console.log(`  폴링 간격: 5분\n`);

  // 즉시 1회 실행 후 5분마다 반복
  await runOnce();
  setInterval(runOnce, POLL_INTERVAL_MS);
}

main().catch(e => {
  console.error('치명적 오류:', e.message);
  process.exit(1);
});
