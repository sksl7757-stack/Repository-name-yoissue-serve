'use strict';

// Stage 2: 처리 — news_raw에서 5개 로드 → 크롤링 → GPT 1회(분석+반응) → 저장

const { loadEnv }     = require('./loadEnv');
const { supabase }    = require('./supabase');
const { scoreImpact } = require('./scoreImpact');

loadEnv();

const OPENAI_KEY = (process.env.OPENAI_API_KEY || '').replace(/['"]/g, '').replace(/[^\x20-\x7E]/g, '');

// ─── 추모일 ───────────────────────────────────────────────────────────────────

const MEMORIAL_DAYS = [
  { mmdd: '04-03', name: '제주 4·3',  keywords: ['4·3', '4.3', '제주4·3', '제주 4·3', '추모', '희생자', '분향'] },
  { mmdd: '04-16', name: '세월호',    keywords: ['세월호', '4·16', '4.16', '세월호 참사', '추모', '희생자', '유가족'] },
  { mmdd: '05-18', name: '5·18',      keywords: ['5·18', '5.18', '광주민주화', '광주항쟁', '추모', '희생자', '묵념'] },
  { mmdd: '10-29', name: '이태원',    keywords: ['이태원', '10·29', '10.29', '이태원 참사', '추모', '희생자', '유가족'] },
];

function getTodayMemorial() {
  const mmdd = new Date().toISOString().slice(5, 10);
  return MEMORIAL_DAYS.find(m => m.mmdd === mmdd) || null;
}

// ─── 표시용 헬퍼 ──────────────────────────────────────────────────────────────

const CATEGORY_EMOJI = {
  '추모': '🕯️', 'IT': '💻', '금융': '💰', '경제': '📈', '부동산': '🏠',
  '정치': '🏛️', '국제': '🌍', '건강': '🏥', '환경': '🌱', '문화': '🎭', '사회': '👥',
};

const DOMAIN_SOURCE = {
  'yna.co.kr': '연합뉴스', 'kbs.co.kr': 'KBS', 'mbc.co.kr': 'MBC',
  'sbs.co.kr': 'SBS', 'jtbc.co.kr': 'JTBC', 'chosun.com': '조선일보',
  'joins.com': '중앙일보', 'donga.com': '동아일보', 'hani.co.kr': '한겨레',
  'khan.co.kr': '경향신문', 'ytn.co.kr': 'YTN', 'hankyung.com': '한국경제',
  'mk.co.kr': '매일경제', 'mt.co.kr': '머니투데이', 'newsis.com': '뉴시스',
  'news1.kr': '뉴스1', 'edaily.co.kr': '이데일리',
};

function inferEmoji(category) {
  return CATEGORY_EMOJI[category] || '📰';
}

function inferSource(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    for (const [domain, name] of Object.entries(DOMAIN_SOURCE)) {
      if (hostname.includes(domain)) return name;
    }
    return hostname;
  } catch {
    return '알 수 없음';
  }
}

function makeSummary(content) {
  if (!content) return ['내용을 불러오지 못했습니다.', '', ''];
  const sentences = content
    .split(/(?<=[다했요음죠임]\.)\s+|[。!?]\s+/)
    .map(s => s.trim().replace(/\s+/g, ' '))
    .filter(s => s.length >= 10);
  const result = sentences.slice(0, 3).map(s => s.slice(0, 25));
  while (result.length < 3) result.push('');
  return result;
}

function stripHtml(str) {
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// ─── 크롤링 ───────────────────────────────────────────────────────────────────

async function fetchArticleContent(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();

    const ogMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
    if (ogMatch) return ogMatch[1].trim().slice(0, 1000);

    const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map(m => stripHtml(m[1]).trim())
      .filter(t => t.length > 30)
      .join(' ');
    if (paragraphs.length > 0) return paragraphs.slice(0, 1000);

    return null;
  } catch {
    return null;
  }
}

// ─── 단일 GPT 호출: 분석 + 반응 ──────────────────────────────────────────────

async function analyzeAndReact(title, content) {
  const prompt = `다음 뉴스를 분석하고 두 캐릭터의 반응을 생성해줘.

뉴스 제목: ${title}
뉴스 내용: ${(content || '').slice(0, 500)}

JSON 형식으로만 응답:
{
  "category": "IT|금융|경제|부동산|정치|국제|건강|환경|문화|사회 중 하나",
  "mood": "긍정적|부정적|중립",
  "junhyuk": "분석형 오빠 준혁의 핵심 정리 한 줄 (감정 없이 객관적으로)",
  "hana": "공감형 언니 하나의 질문 (자연스러운 말투, 마지막에 '좋음 / 모르겠음 / 걱정됨' 선택지 포함)"
}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 400,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error('OpenAI 오류: ' + data.error.message);
  return JSON.parse(data.choices[0].message.content);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now();
  console.log('🚀 [Stage 2] process-news 시작:', new Date().toISOString());

  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY 없음');

  const today = new Date().toISOString().slice(0, 10);
  const memorial = getTodayMemorial();

  // 1. 미처리 뉴스 최대 5건 로드
  const { data: rawRows, error: loadErr } = await supabase
    .from('news_raw')
    .select('*')
    .eq('date', today)
    .eq('processed', false)
    .limit(5);

  if (loadErr) throw new Error('news_raw 로드 오류: ' + loadErr.message);
  if (!rawRows || rawRows.length === 0) {
    console.log('  처리할 뉴스 없음 (select-news가 먼저 실행되어야 함)');
    console.log(`✅ [Stage 2] 완료: ${Date.now() - start}ms`);
    return;
  }
  console.log(`  미처리 뉴스 ${rawRows.length}건 로드`);

  // 2. 순차 처리
  const results = [];

  for (const row of rawRows) {
    const itemStart = Date.now();
    try {
      // 크롤링
      const content = await fetchArticleContent(row.url);
      if (!content) {
        console.log(`  [SKIP] 크롤링 실패: ${row.title.slice(0, 40)}`);
        await supabase.from('news_raw').update({ processed: true }).eq('id', row.id);
        continue;
      }

      // 추모일이면 관련 기사만 처리
      if (memorial && !memorial.keywords.some(kw => row.title.includes(kw) || content.includes(kw))) {
        console.log(`  [SKIP] 추모일 — 비관련 기사: ${row.title.slice(0, 40)}`);
        await supabase.from('news_raw').update({ processed: true }).eq('id', row.id);
        continue;
      }

      // GPT 1회 호출 (분석 + 반응)
      const gpt = await analyzeAndReact(row.title, content);

      const category = memorial ? '추모' : (gpt.category || '사회');
      const tag      = `오늘의 픽 · ${category}`;
      const score    = scoreImpact({ title: row.title, content });

      const record = {
        date:      today,
        title:     row.title,
        url:       row.url,
        content,
        category,
        tag,
        emoji:     inferEmoji(category),
        summary:   makeSummary(content),
        source:    inferSource(row.url),
        link:      row.url,
        mood:      gpt.mood || '중립',
        reactions: { junhyuk: gpt.junhyuk || '', hana: gpt.hana || '' },
        score,
        pushed:    false,
      };

      // news_processed 저장
      const { error: insertErr } = await supabase.from('news_processed').insert(record);
      if (insertErr) {
        console.error(`  news_processed 저장 오류: ${insertErr.message}`);
      }

      // news_raw 처리 완료 표시
      await supabase.from('news_raw').update({ processed: true }).eq('id', row.id);

      results.push(record);
      console.log(`  [OK] ${Date.now() - itemStart}ms | [${score}점] ${row.title.slice(0, 40)}`);
    } catch (e) {
      console.error(`  [ERR] ${row.title?.slice(0, 40)} —`, e.message);
    }
  }

  // 3. 최고점 기사를 daily_news에 저장
  if (results.length > 0) {
    const best = results.sort((a, b) => b.score - a.score)[0];
    const { error: dailyErr } = await supabase
      .from('daily_news')
      .upsert(best, { onConflict: 'date' });
    if (dailyErr) {
      console.error('  daily_news 저장 오류:', dailyErr.message);
    } else {
      console.log(`  daily_news 저장: ${best.title.slice(0, 40)}`);
    }
  } else {
    console.warn('  처리된 기사 없음 — daily_news 미갱신');
  }

  console.log(`✅ [Stage 2] 완료: ${Date.now() - start}ms`);
}

module.exports = { main };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
