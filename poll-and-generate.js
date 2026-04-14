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
// situation: positive / worry          (캐릭터당 2장)
// after:     positive / negative / worry (캐릭터당 3장)
// 총 캐릭터당 5장
const SITUATION_EMOTIONS = ['positive', 'worry'];
const AFTER_EMOTIONS     = ['positive', 'negative', 'worry'];

const IMAGE_COMBOS = CHARACTERS.flatMap(({ charKey, character }) => [
  ...SITUATION_EMOTIONS.map(emotion => ({ charKey, character, imageType: 'situation', emotion })),
  ...AFTER_EMOTIONS.map(emotion     => ({ charKey, character, imageType: 'after',     emotion })),
]);

// ── 유틸 ────────────────────────────────────────────────────────────────────────
function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// {날짜}_{charKey}_{imageType}_{emotion}.png
function storagePath(date, charKey, imageType, emotion) {
  return `${date}_${charKey}_${imageType}_${emotion}.png`;
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

// ── Supabase Storage: 이미지 존재 여부 확인 ────────────────────────────────────
async function imageExists(filePath) {
  // list()로 해당 파일이 버킷 루트에 있는지 확인
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list('', { search: filePath });
  if (error) throw new Error('Storage list 오류: ' + error.message);
  return (data || []).some(f => f.name === filePath);
}

// ── GPT: 이미지 프롬프트 생성 ───────────────────────────────────────────────────
async function buildImagePrompt({ category, emotion, character, imageType, newsTitle }) {
  const typeGuide = imageType === 'situation'
    ? 'Draw the news scene/situation itself with the character observing or standing in it. Focus on the news event backdrop.'
    : 'Draw the character reacting/responding after hearing the news. Focus on the character\'s emotional expression and body language.';

  const systemMsg = `You are an AI that writes image generation prompts for a Korean news app.
The app has two characters: Hana (female, warm, friendly) and Junhyuk (male, calm, analytical).
Write a concise English prompt (under 80 words) for a webtoon/anime-style illustration that:
- ${typeGuide}
- Reflects the news topic (category: ${category}) and emotional tone (${emotion})
- Uses soft cel-shading, clean lines, pastel background
Return ONLY the prompt text, nothing else.`;

  const userMsg = `Character: ${character}, Emotion: ${emotion}, News: ${newsTitle}`;

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
  const filePath = storagePath(date, combo.charKey, combo.imageType, combo.emotion);
  const label    = `${combo.charKey}_${combo.imageType}_${combo.emotion}`;

  // 1. 이미 있으면 스킵
  const exists = await imageExists(filePath);
  if (exists) {
    console.log(`  [SKIP] ${filePath} (이미 존재)`);
    return { label, filePath, status: 'skipped' };
  }

  console.log(`  [GEN]  ${filePath}`);

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
  const workflow  = buildComfyWorkflow(imagePrompt, SD_MODEL);
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

  // 6. Supabase Storage 업로드
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, buffer, { contentType: 'image/png', upsert: true });
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

  // 2. 각 조합에 대해 이미지 생성/업로드
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
