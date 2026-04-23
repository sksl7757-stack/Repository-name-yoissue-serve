'use strict';

// stance-news.js — 수동 크론 스크립트.
// 오늘 daily_news 조회 → GPT 1회 호출로 대립 구도 JSON 생성 → daily_news.stance UPDATE.
// 실행: node stance-news.js
// 재시도: OpenAI 실패 시 5분 간격 3회 재시도 후 종료.

const { loadEnv } = require('./loadEnv');
loadEnv();

const { supabase, getTodayNews } = require('./supabase');

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5 * 60 * 1000;

const STANCE_PROMPT = `너는 뉴스 한 건을 보고 두 캐릭터(하나, 준혁)가 자연스럽게 티격태격할 수 있는 대립 구도를 설정하는 AI.

【캐릭터】
- 하나: 감성·공감형 20대 여성. 뉴스를 사람·이야기·감정 축으로 해석.
- 준혁: 냉철·분석형 20대 남성. 뉴스를 숫자·구조·인과 축으로 해석.

【출력 형식 — JSON 고정, 다른 텍스트 없이】
{
  "axis":         "짧은 대립축 라벨 (예: 단기 vs 장기, 개인 선택 vs 공공 책임)",
  "hana_side":    "하나가 취할 쪽의 짧은 설명 (예: 단기 생활 체감)",
  "junhyuk_side": "준혁이 취할 쪽의 짧은 설명 (예: 장기 구조 변화)"
}

【원칙】
- 뉴스 맥락 안에서 두 캐릭터 성격과 자연스럽게 맞는 축을 선택
- 정치 논쟁·이념 대립·인물 평가 회피
- 축은 간결하게. 각 쪽 설명도 한 줄 이내`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callOpenAI(newsContext) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY?.replace(/['"]/g, '');
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY 미설정');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.4-mini',
      max_tokens: 300,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: STANCE_PROMPT },
        { role: 'user', content: newsContext },
      ],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error('OpenAI: ' + data.error.message);
  const raw = data?.choices?.[0]?.message?.content || '{}';
  const parsed = JSON.parse(raw);
  const stance = {
    axis:         String(parsed.axis         || '').trim(),
    hana_side:    String(parsed.hana_side    || '').trim(),
    junhyuk_side: String(parsed.junhyuk_side || '').trim(),
  };
  if (!stance.axis || !stance.hana_side || !stance.junhyuk_side) {
    throw new Error('stance JSON 필드 누락: ' + JSON.stringify(parsed));
  }
  return stance;
}

async function generateWithRetry(newsContext) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[stance] 시도 ${attempt}/${MAX_RETRIES}...`);
      return await callOpenAI(newsContext);
    } catch (e) {
      lastErr = e;
      console.error(`[stance] 시도 ${attempt} 실패:`, e.message);
      if (attempt < MAX_RETRIES) {
        console.log(`[stance] ${RETRY_DELAY_MS / 1000}초 후 재시도...`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  throw lastErr;
}

(async () => {
  const news = await getTodayNews();
  if (!news) {
    console.error('오늘 daily_news 없음. 먼저 select-news.js + process-news.js 실행 필요.');
    process.exit(1);
  }

  console.log('=== 오늘 뉴스 ===');
  console.log('제목:', news.title);
  console.log('카테고리:', news.category);
  console.log('추모:', Boolean(news.is_mourning_required));

  if (news.is_mourning_required) {
    console.log('추모 뉴스 — stance 생성 생략 (추모 모드는 대립 없음)');
    process.exit(0);
  }

  if (news.stance && news.stance.axis) {
    console.log('기존 stance 있음:', news.stance, '— 덮어쓰기 진행');
  }

  const summaryText = Array.isArray(news.summary) ? news.summary.join(' ') : (news.summary || '');
  const bodyText = news.content && news.content.length >= 100 ? news.content : summaryText;
  const newsContext = `분류: ${news.category}\n제목: ${news.title}\n요약: ${summaryText}${bodyText ? '\n본문: ' + bodyText : ''}`;

  const stance = await generateWithRetry(newsContext);
  console.log('\n=== 생성된 stance ===');
  console.log(JSON.stringify(stance, null, 2));

  const { error } = await supabase
    .from('daily_news')
    .update({ stance })
    .eq('date', news.date);
  if (error) throw new Error('Supabase UPDATE 실패: ' + error.message);

  console.log('\n✓ daily_news.stance 업데이트 완료 (date=' + news.date + ')');
  process.exit(0);
})().catch(e => {
  console.error('[stance-news] 치명적 오류:', e.message);
  process.exit(1);
});
