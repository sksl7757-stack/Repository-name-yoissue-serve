// Railway 환경에서는 process.env 직접 사용, 로컬에서만 .env 로드
const fs = require('fs');
if (fs.existsSync(__dirname + '/.env')) {
  require('dotenv').config({ path: __dirname + '/.env' });
}
const express = require('express');
const cors = require('cors');

const { getState, updateState } = require('./stateManager');
const { generateReply, buildSystemPrompt } = require('./generator');
const { validate } = require('./validator');
const { buildResponse } = require('./responseBuilder');
const { saveNews, getSavedNews } = require('./saveNews');
const { addRecord, getRecords } = require('./records');
const { supabase } = require('./supabase');
const { buildComfyWorkflow } = require('./comfyUtils');
const { interpretNews }    = require('./newsInterpreter');
const { buildImagePrompt } = require('./promptBuilder');

const app = express();
app.use(cors());
app.use(express.json());

// ── 푸시 토큰: Supabase push_tokens 테이블 ────────────────────────────────────

async function readTokens() {
  const { data, error } = await supabase
    .from('push_tokens')
    .select('token');
  if (error) { console.error('push_tokens 조회 오류:', error.message); return []; }
  return (data || []).map(r => r.token);
}

async function upsertToken(token) {
  const { error } = await supabase
    .from('push_tokens')
    .upsert({ token }, { onConflict: 'token' });
  if (error) console.error('push_tokens upsert 오류:', error.message);
}

app.get('/health', (_req, res) => {
  const openai = process.env.OPENAI_API_KEY;
  const supabase_url = process.env.SUPABASE_URL;
  res.json({
    openai_exists: !!openai,
    openai_length: openai ? openai.length : 0,
    openai_first3: openai ? openai.slice(0, 3) : 'none',
    supabase_url_exists: !!supabase_url,
    supabase_url_value: supabase_url ? supabase_url.slice(0, 20) : 'none',
    node_env: process.env.NODE_ENV,
    all_keys: Object.keys(process.env).filter(k =>
      ['OPENAI', 'SUPABASE', 'NAVER'].some(prefix => k.startsWith(prefix))
    ),
  });
});

const OPENING_MESSAGES = {
  경제: ['이거 은근 생활비랑 연결되는 얘긴데', '요즘 물가 생각하면 좀 신경 쓰이는 얘기야', '이거 우리 지갑이랑 관련 있을 수도 있어', '오늘 경제 쪽 포인트 하나 있는데', '결론부터 말하면 생활에 영향 있을 가능성 있음'],
  정치: ['이거 좀 복잡한 얘긴데', '이거 은근 우리랑 연결되는 얘기더라', '오늘 정치 쪽 흐름 하나 짚어보면', '이건 구조 알면 이해됨', '이건 배경 알아야 이해되는 내용임'],
  사회: ['이거 좀 마음에 걸리는 얘긴데', '이거 은근 주변이랑 연결되는 얘기야', '오늘 사회 쪽 이슈 하나 있는데', '이건 한 번 짚어볼 필요 있음', '이건 영향 범위 생각해볼 필요 있음'],
  IT: ['이거 생각보다 우리 생활이랑 가깝더라', '이거 은근 흥미로운 얘기야', '오늘 IT 쪽 포인트 하나 있는데', '이건 알아두면 도움될 가능성 있음', '이건 앞으로 영향 있을 내용임'],
  국제: ['이거 멀어 보여도 은근 우리랑 연결돼', '이거 생각보다 가까운 얘기일 수도 있어', '오늘 국제 흐름 하나 짚어보면', '이건 알아두면 나쁘지 않음', '이건 배경 알면 이해됨'],
  금융: ['이거 돈이랑 직접 연결되는 얘긴데', '이거 은근 중요한 얘기더라', '오늘 금융 쪽 포인트 하나 있는데', '이건 한 번 짚고 넘어갈 필요 있음', '결론부터 말하면 영향 있을 가능성 있음'],
  문화: ['이거 은근 재밌는 얘기야', '이거 좀 흥미롭더라', '오늘 문화 쪽 이슈 하나 있는데', '이건 관심 있으면 볼 만한 내용임', '이건 흐름 보면 이해됨'],
  환경: ['이거 생각보다 가까운 얘기야', '이거 은근 신경 쓰이는 흐름이긴 해', '오늘 환경 쪽 포인트 하나 있는데', '이건 장기적으로 영향 있을 내용임', '이건 알아두면 나쁘지 않음'],
  건강: ['이거 몸이랑 연결되는 얘긴데', '이거 은근 신경 쓰일 수도 있겠다', '오늘 건강 쪽 이슈 하나 있는데', '이건 생활이랑 직접 연결된 내용임', '이건 알아두면 도움될 가능성 있음'],
  부동산: ['이거 집이랑 연결되는 얘긴데', '이거 은근 생활이랑 가까운 얘기야', '오늘 부동산 쪽 포인트 하나 있는데', '이건 주거 비용이랑 연결된 내용임', '결론부터 말하면 영향 있을 가능성 있음'],
};

app.post('/chat-opening', async (req, res) => {
  const { character, memory } = req.body;
  try {
    const OPENAI_KEY = process.env.OPENAI_API_KEY?.replace(/['"]/g, '');
    const baseSystem = buildSystemPrompt(character, memory, { phase: 'INIT' });
    const systemWithFormat = baseSystem + `\n\n【출력 형식】 아래 JSON으로만 반환. 다른 텍스트 없이:\n{"opening": "뉴스 보기 전 궁금증 유발 한 줄", "comment": "뉴스 카드 본 후 생활 영향/공감 한 줄. 반드시 유저가 자연스럽게 대답하고 싶어지는 열린 질문으로 끝낼 것."}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemWithFormat },
          { role: 'user', content: '오늘 뉴스 오프닝이랑 코멘트 만들어줘' },
        ],
      }),
    });
    const data = await response.json();
    const result = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
    res.json({ opening: result.opening || '', comment: result.comment || '' });
  } catch (e) {
    console.log('chat-opening 에러:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// /chat — harness orchestration
app.post('/chat', async (req, res) => {
  const { type, messages, character, memory, perspectiveStep = 0, primaryCharName = null, primaryComment = null, primaryEmotion = null, characterEmotion = null } = req.body;
  try {
    // PERSPECTIVE_NEXT: 시스템 트리거 — topic 검사 없이 바로 생성
    if (type === 'PERSPECTIVE_NEXT') {
      // perspectiveStep은 클라이언트가 이미 증가시켜서 전송 (서버는 stateless)
      if (perspectiveStep > 2) {
        return res.json({
          message: character === '하나'
            ? '나 이 얘기는 여기까지면 충분한 것 같아 🌸 내일 또 같이 보자'
            : '이 정도면 핵심은 다 봤어. 내일 다시 보자',
          question: null,
          end: true,
        });
      }
      console.log('[stance-in]', character, '→', characterEmotion);
      const rawReply = await generateReply({ character, messages, memory, perspectiveStep, isPerspectiveRequest: true, characterEmotion });
      const validatedReply = validate({ reply: rawReply.text, phase: 'CHAT', character });
      return res.json(buildResponse({ message: validatedReply.message, question: validatedReply.question, emotion: rawReply.emotion }));
    }

    // 1. state 읽기 (코드에서만 결정 — LLM 관여 없음)
    const { phase, questionAsked } = getState(messages, perspectiveStep);


    // 3. generator 실행 (말투/스타일만 담당)
    console.log('[stance-in]', character, '→', characterEmotion);
    const rawReply = await generateReply({ character, messages, memory, perspectiveStep, phase, primaryCharName, primaryComment, primaryEmotion, characterEmotion });
    console.log('generator reply:', rawReply);

    // 4. validator 실행 (질문 추가/제거, 주제 이탈 — 코드에서만 결정)
    const validatedReply = validate({ reply: rawReply.text, phase, character });
    console.log('validated:', JSON.stringify({
      message: validatedReply.message?.slice(0, 80),
      question: validatedReply.question,
    }));

    // 4-1. validator가 질문을 추가했으면 state 업데이트 (다음 요청 대비 로깅용)
    const updatedState = updateState({ phase, questionAsked }, {
      questionAsked: !!validatedReply.question,
    });
    console.log('state:', updatedState);

    // 5. responseBuilder로 최종 응답 생성
    res.json(buildResponse({ message: validatedReply.message, question: validatedReply.question, phase, emotion: rawReply.emotion }));
  } catch (e) {
    console.log('chat 에러:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/analyze-memory', async (req, res) => {
  const { messages, currentMemory } = req.body;
  try {
    const OPENAI_KEY = process.env.OPENAI_API_KEY?.replace(/['"]/g, '');
    const prompt = `너는 사용자 성향 분석 AI야.

아래 대화 내역을 읽고, 사용자에 대해 장기적으로 기억해두면 유익한 정보만 추출해줘.

추출 기준:
- 포함: 반복되는 관심사, 직업/생활환경 힌트, 뉴스를 보는 관점이나 가치관, 자주 묻는 주제 패턴
- 제외: 일시적 감정("오늘 피곤해"), 단순 잡담, 한 번만 언급된 사소한 내용

기존 메모리와 합쳐서 중복 제거 후 전체 항목을 최대 10개로 압축해서 아래 JSON 형식으로만 반환해. 다른 텍스트 없이 JSON만:
{
  "interests": ["관심사1", "관심사2"],
  "traits": ["성향1", "성향2"],
  "context": "한 줄 요약 (직업·생활환경 등)"
}

기존 메모리:
${JSON.stringify(currentMemory || {}, null, 2)}

오늘 대화:
${JSON.stringify(messages || [], null, 2)}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 500,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const result = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
    res.json(result);
  } catch (e) {
    console.log('analyze-memory 에러:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/register-token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });
  await upsertToken(token);
  const tokens = await readTokens();
  res.json({ ok: true, total: tokens.length });
});

app.post('/send-notifications', async (req, res) => {
  const { tag } = req.body;
  const tokens = await readTokens();
  if (tokens.length === 0) return res.json({ sent: 0 });

  const rawTag = (tag || '').split('· ').pop()?.trim();
  const pool = OPENING_MESSAGES[rawTag] || [];
  const body = pool.length > 0
    ? pool[Math.floor(Math.random() * pool.length)]
    : '오늘의 이슈가 도착했어요!';

  const messages = tokens.map(token => ({
    to: token,
    title: '오늘의 픽 도착 🔔',
    body,
    data: { tag },
  }));

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(messages),
    });
    const result = await response.json();
    console.log('푸시 발송 결과:', JSON.stringify(result));
    res.json({ sent: tokens.length, body });
  } catch (e) {
    console.log('푸시 발송 에러:', e.message);
    res.status(500).json({ error: e.message });
  }
});


app.post('/save-news', async (req, res) => {
  const { userId, newsId } = req.body;
  if (!userId || !newsId) return res.status(400).json({ error: 'userId와 newsId 필요' });
  try {
    const result = await saveNews(userId, newsId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/saved-news', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId 필요' });
  try {
    const list = await getSavedNews(userId);
    res.json({ savedNews: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/records', async (req, res) => {
  const { userId, newsId, title, character, userChoice, createdAt } = req.body;
  if (!userId || !newsId) return res.status(400).json({ error: 'userId와 newsId 필요' });
  try {
    const result = await addRecord(userId, { newsId, title, character, userChoice, createdAt });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/records', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId 필요' });
  try {
    const list = await getRecords(userId);
    res.json({ records: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ── /generate-image ──────────────────────────────────────────────────────────
// body: { category, emotion, character, newsTitle }
// 1. GPT로 영어 이미지 프롬프트 생성
// 2. ComfyUI /prompt 로 이미지 생성 요청
// 3. /history 폴링 → 완성된 이미지 base64 반환

// interpretNews, buildImagePrompt → ./newsInterpreter

async function pollComfyHistory(baseUrl, promptId, maxWaitMs = 120000) {
  const interval = 2000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, interval));
    const res  = await fetch(`${baseUrl}/history/${promptId}`);
    const data = await res.json();
    const entry = data[promptId];
    if (!entry) continue;

    const outputs = entry.outputs || {};
    for (const nodeId of Object.keys(outputs)) {
      const images = outputs[nodeId]?.images;
      if (images?.length) return images[0]; // { filename, subfolder, type }
    }
  }
  throw new Error('ComfyUI 이미지 생성 타임아웃');
}

app.post('/generate-image', async (req, res) => {
  const { category, emotion, character, newsTitle } = req.body;
  if (!category || !emotion || !character || !newsTitle) {
    return res.status(400).json({ error: 'category, emotion, character, newsTitle 필요' });
  }

  const SD_URL = process.env.COMFY_URL || 'http://localhost:8188';

  try {
    // 1. GPT로 영어 프롬프트 생성
    const imagePrompt = buildImagePrompt({ category, emotion, character, newsTitle });
    console.log('[generate-image] prompt:', imagePrompt);

    // 2. ComfyUI /prompt 에 워크플로 전송
    const workflow = buildComfyWorkflow(imagePrompt);
    const queueRes = await fetch(`${SD_URL}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });
    const queueData = await queueRes.json();
    const promptId  = queueData.prompt_id;
    if (!promptId) throw new Error('ComfyUI prompt_id 없음: ' + JSON.stringify(queueData));
    console.log('[generate-image] prompt_id:', promptId);

    // 3. /history 폴링 → 이미지 파일 정보 획득
    const imageInfo = await pollComfyHistory(SD_URL, promptId);
    console.log('[generate-image] imageInfo:', imageInfo);

    // 4. /view 로 이미지 바이너리 가져오기
    const viewUrl = `${SD_URL}/view?filename=${encodeURIComponent(imageInfo.filename)}&subfolder=${encodeURIComponent(imageInfo.subfolder || '')}&type=${imageInfo.type || 'output'}`;
    const imgRes  = await fetch(viewUrl);
    if (!imgRes.ok) throw new Error(`ComfyUI /view 실패: ${imgRes.status}`);

    const buffer     = await imgRes.arrayBuffer();
    const base64     = Buffer.from(buffer).toString('base64');
    const mimeType   = imgRes.headers.get('content-type') || 'image/png';

    res.json({ image: `data:${mimeType};base64,${base64}`, prompt: imagePrompt });
  } catch (e) {
    console.log('[generate-image] 에러:', e.message);
    res.status(500).json({ error: e.message });
  }
});


// ── /start-image-generation ──────────────────────────────────────────────────
// select-news.js 완료 후 트리거. 오늘 뉴스 기반으로 필요한 이미지 조합 생성 후
// Supabase Storage yoissue-images 버킷에 업로드.
// body: { category, tag, title }

const IMAGE_COMBOS = [
  { character: '하나',  charKey: 'hana',    imageType: 'situation', emotion: 'positive' },
  { character: '하나',  charKey: 'hana',    imageType: 'situation', emotion: 'negative' },
  { character: '하나',  charKey: 'hana',    imageType: 'after',     emotion: 'positive' },
  { character: '하나',  charKey: 'hana',    imageType: 'after',     emotion: 'negative' },
  { character: '하나',  charKey: 'hana',    imageType: 'after',     emotion: 'unsure'   },
  { character: '준혁', charKey: 'junhyuk', imageType: 'situation', emotion: 'positive' },
  { character: '준혁', charKey: 'junhyuk', imageType: 'situation', emotion: 'negative' },
  { character: '준혁', charKey: 'junhyuk', imageType: 'after',     emotion: 'positive' },
  { character: '준혁', charKey: 'junhyuk', imageType: 'after',     emotion: 'negative' },
  { character: '준혁', charKey: 'junhyuk', imageType: 'after',     emotion: 'unsure'   },
];

app.post('/start-image-generation', async (req, res) => {
  const { category, title } = req.body;
  if (!category || !title) {
    return res.status(400).json({ error: 'category, title 필요' });
  }

  const SD_URL = process.env.COMFY_URL || 'http://localhost:8188';

  const today = new Date().toISOString().slice(0, 10);
  const results = [];

  // 즉시 응답 후 백그라운드 생성 (이미지 생성은 오래 걸림)
  res.json({ ok: true, message: `이미지 생성 시작 (${IMAGE_COMBOS.length}개)`, date: today });

  // 백그라운드 처리 — 최상위 try-catch로 unhandled rejection 방지
  (async () => {
    try {
      // 뉴스 장면 해석 (GPT 1회 — situation 이미지 전체에서 공유)
      const interpretation = await interpretNews({ category, newsTitle: title });
      console.log(`[start-image-generation] 해석 완료: ${interpretation.event_core}`);

      for (const combo of IMAGE_COMBOS) {
        const label = `${combo.charKey}_${combo.imageType}_${combo.emotion}`;
        try {
          console.log(`[start-image-generation] 생성 중: ${label}`);

          // 1. 프롬프트 생성
          const imagePrompt = buildImagePrompt({
            emotion:   combo.emotion,
            character: combo.character,
            imageType: combo.imageType,
            interpretation,
          });

          // 2. ComfyUI 생성 요청
          const workflow = buildComfyWorkflow(imagePrompt);
          const queueRes = await fetch(`${SD_URL}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: workflow }),
          });
          const queueData = await queueRes.json();
          const promptId  = queueData.prompt_id;
          if (!promptId) throw new Error('prompt_id 없음: ' + JSON.stringify(queueData));

          // 3. /history 폴링
          const imageInfo = await pollComfyHistory(SD_URL, promptId);

          // 4. 이미지 바이너리 가져오기
          const viewUrl = `${SD_URL}/view?filename=${encodeURIComponent(imageInfo.filename)}&subfolder=${encodeURIComponent(imageInfo.subfolder || '')}&type=${imageInfo.type || 'output'}`;
          const imgRes  = await fetch(viewUrl);
          if (!imgRes.ok) throw new Error(`ComfyUI /view 실패: ${imgRes.status}`);
          const buffer = await imgRes.arrayBuffer();

          // 5. Supabase Storage 업로드 (폴더 기반 유니크 경로)
          const imagePath = `${today}/${combo.charKey}/${combo.imageType}/${combo.emotion}/${Date.now()}.png`;
          const { error: uploadError } = await supabase.storage
            .from('yoissue-images')
            .upload(imagePath, Buffer.from(buffer), {
              contentType: 'image/png',
              upsert: false,
              cacheControl: '3600',
            });
          if (uploadError) throw new Error('Storage 업로드 오류: ' + uploadError.message);

          console.log(`[start-image-generation] 완료: ${imagePath}`);
          results.push({ label, imagePath, ok: true });
        } catch (e) {
          console.error(`[start-image-generation] 실패: ${label}`, e.message);
          results.push({ label, ok: false, error: e.message });
        }
      }
      // 생성된 image_paths를 daily_news에 저장
      const imagePaths = results.filter(r => r.ok).map(r => r.imagePath);
      if (imagePaths.length > 0) {
        const { error: updateError } = await supabase.from('daily_news')
          .update({ image_paths: imagePaths })
          .eq('date', today);
        if (updateError) console.error('[start-image-generation] image_paths 저장 실패:', updateError.message);
      }
      console.log('[start-image-generation] 전체 완료:', results);
    } catch (e) {
      // 루프 밖 예상치 못한 에러 (fetch 자체 실패 등)
      console.error('[start-image-generation] 치명적 오류:', e.message);
    }
  })();
});


if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`서버 실행중 port ${PORT}`));
}

module.exports = app;