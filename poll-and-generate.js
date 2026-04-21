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

const fs   = require('fs');
const path = require('path');

const { loadEnv } = require('./loadEnv');
loadEnv();

const { createClient } = require('@supabase/supabase-js');
const { buildComfyWorkflow } = require('./comfyUtils');
const { interpretNews }   = require('./newsInterpreter');
const { buildImagePrompt } = require('./promptBuilder');
const { todayKST } = require('./dateUtil');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const COMFY_URL    = process.env.COMFY_URL || 'http://localhost:8188';
const BUCKET       = 'yoissue-images';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5분
const LOCK_FILE    = path.join(__dirname, '.poll-generate.lock');
const STATE_FILE   = path.join(__dirname, '.generated-state.json');

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
const today = todayKST; // KST 기준 YYYY-MM-DD

// {날짜}/{charKey}/{imageType}/{emotion}/{timestamp}.png
function storagePath(date, charKey, imageType, emotion) {
  return `${date}/${charKey}/${imageType}/${emotion}/${Date.now()}.png`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── 뉴스 변경 감지용 로컬 상태 ────────────────────────────────────────────────────
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { date: '', title: '' }; }
}

function saveState(date, title) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ date, title }), 'utf8');
}

// ── 날짜별 Storage 폴더 전체 삭제 ─────────────────────────────────────────────────
async function clearStorageForDate(date) {
  console.log(`  🗑️  Storage ${date}/ 초기화 중...`);
  for (const { charKey } of CHARACTERS) {
    for (const imageType of ['situation', 'after']) {
      const emotions = imageType === 'situation' ? SITUATION_EMOTIONS : AFTER_EMOTIONS;
      for (const emotion of emotions) {
        const folder = `${date}/${charKey}/${imageType}/${emotion}`;
        const { data: files } = await supabase.storage.from(BUCKET).list(folder);
        if (files && files.length > 0) {
          const paths = files.map(f => `${folder}/${f.name}`);
          await supabase.storage.from(BUCKET).remove(paths);
          console.log(`    삭제: ${folder}/ (${paths.length}개)`);
        }
      }
    }
  }
}

// ── Supabase: 오늘 뉴스 조회 ────────────────────────────────────────────────────
async function getTodayNews() {
  const { data, error } = await supabase
    .from('daily_news')
    .select('date, title, category, summary, content, is_mourning_required')
    .eq('date', today())
    .maybeSingle();
  if (error) throw new Error('daily_news 조회 오류: ' + error.message);
  return data; // null이면 오늘 뉴스 없음
}

// interpretNews, buildImagePrompt → ./newsInterpreter

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
async function generateAndUpload({ date, newsTitle, combo, interpretation }) {
  const label = `${combo.charKey}_${combo.imageType}_${combo.emotion}`;
  console.log(`🖼️ 이미지 생성 호출됨: ${label} @ ${new Date().toISOString()}`);

  // 2. 프롬프트 생성
  const imagePrompt = buildImagePrompt({
    emotion:   combo.emotion,
    character: combo.character,
    imageType: combo.imageType,
    newsTitle,
    interpretation,
  });
  console.log(`         prompt:\n${imagePrompt}`);

  // 3. ComfyUI에 워크플로 전송
  const workflow = buildComfyWorkflow(imagePrompt);
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
let isRunning = false;

async function runOnce() {
  if (isRunning) {
    console.log('  ⏳ 이전 실행 진행 중 — 스킵');
    return;
  }
  isRunning = true;
  try {
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

  // 뉴스 변경 감지 — 같은 날 뉴스가 바뀌면 Storage 초기화
  const state = loadState();
  if (state.date === date && state.title !== news.title) {
    console.log(`  ⚠️  뉴스 변경 감지`);
    console.log(`      이전: ${state.title.slice(0, 50)}`);
    console.log(`      현재: ${news.title.slice(0, 50)}`);
    await clearStorageForDate(date);
  }

  // 2. 뉴스 장면 해석 (GPT 1회 — situation 이미지 전체에서 공유)
  let interpretation;
  try {
    const summaryRaw = news.summary;
    const summaryText = Array.isArray(summaryRaw) ? summaryRaw.join(' ') : (summaryRaw || '');
    const bodyText = news.content && news.content.length >= 100 ? news.content : summaryText;
    interpretation = await interpretNews({ category: news.category, newsTitle: news.title, newsSummary: bodyText });
    console.log(`  해석 완료: ${interpretation.news_core}`);
  } catch (e) {
    console.error('  interpretNews 실패:', e.message);
    return;
  }

  // DB 플래그 우선, 없으면 interpretNews GPT 판정 폴백
  const mourning = news.is_mourning_required ?? interpretation.is_mourning_required ?? false;
  if (mourning) {
    console.log(`  ⚠️  is_mourning_required=true — positive/unsure 이미지 스킵`);
  }

  // 3. 각 조합에 대해 Storage 직접 확인 후 생성/스킵
  // is_mourning_required=true 이면 positive/unsure emotion 조합 제외
  const effectiveCombos = mourning
    ? IMAGE_COMBOS.filter(c => c.emotion !== 'positive' && c.emotion !== 'unsure')
    : IMAGE_COMBOS;
  console.log(`📊 이미지 생성 시작 — 총 ${effectiveCombos.length}개 조합${mourning ? ' (positive/unsure 제외)' : ''}`);
  const results = [];
  let count = 0;
  for (const combo of effectiveCombos) {
    count++;
    const label = `${combo.charKey}_${combo.imageType}_${combo.emotion}`;
    const folder = `${date}/${combo.charKey}/${combo.imageType}/${combo.emotion}`;

    // Storage에서 직접 존재 여부 확인 (DB 컬럼 의존 안 함)
    const { data: storageFiles } = await supabase.storage.from(BUCKET).list(folder);
    if (storageFiles && storageFiles.length > 0) {
      console.log(`📊 ${count}/${effectiveCombos.length} ✅ 스킵: ${label} (Storage에 존재)`);
      results.push({ label, status: 'skipped', filePath: `${folder}/${storageFiles[0].name}` });
      continue;
    }

    console.log(`📊 ${count}/${effectiveCombos.length} 생성: ${label}`);
    try {
      const result = await generateAndUpload({
        date,
        newsTitle: news.title,
        combo,
        interpretation,
      });
      results.push(result);
    } catch (e) {
      console.error(`  [ERR]  ${label}: ${e.message}`);
      results.push({ label, status: 'error', error: e.message });
    }
  }

  // 결과 요약
  const generated = results.filter(r => r.status === 'generated').length;
  const skipped   = results.filter(r => r.status === 'skipped').length;
  const errors    = results.filter(r => r.status === 'error').length;
  console.log(`  완료 — 생성: ${generated}개 / 스킵: ${skipped}개 / 오류: ${errors}개`);

  // image_paths 업데이트 (앱에서 읽기 위해 — 스킵된 것 포함 전체)
  const allPaths = results.filter(r => r.filePath).map(r => r.filePath);
  if (allPaths.length > 0) {
    const { error: updateError } = await supabase.from('daily_news')
      .update({ image_paths: allPaths })
      .eq('date', date);
    if (updateError) console.error('  image_paths 저장 실패:', updateError.message);
    else console.log(`  image_paths 저장 완료 (총 ${allPaths.length}개)`);
  }

  // 이 뉴스로 이미지 생성 완료 — 상태 저장
  saveState(date, news.title);
  } finally {
    isRunning = false;
  }
}

async function main() {
  // ── 프로세스 중복 실행 방지 ────────────────────────────────────────────────────
  if (fs.existsSync(LOCK_FILE)) {
    const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch {}
    if (alive) {
      console.error(`⛔ 이미 실행 중인 인스턴스가 있습니다 (PID: ${pid})`);
      console.error(`   종료하려면: taskkill /F /PID ${pid}`);
      process.exit(1);
    } else {
      console.log(`⚠️  이전 락 파일 발견 (PID: ${pid} — 이미 종료됨). 락 파일 삭제 후 계속.`);
      fs.unlinkSync(LOCK_FILE);
    }
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  const cleanupLock = () => { try { fs.unlinkSync(LOCK_FILE); } catch {} };
  process.on('exit', cleanupLock);
  process.on('SIGINT',  () => { cleanupLock(); process.exit(0); });
  process.on('SIGTERM', () => { cleanupLock(); process.exit(0); });

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
