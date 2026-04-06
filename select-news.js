const path = require('path');
const fs = require('fs');

// .env를 fs로 직접 읽어 파싱 (dotenvx 암호화 우회)
const envPath = path.join(__dirname, '.env');
fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const eq = trimmed.indexOf('=');
  if (eq === -1) return;
  const key = trimmed.slice(0, eq).trim();
  const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  if (key) process.env[key] = val;
});

const NAVER_ID = process.env.NAVER_CLIENT_ID;
const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET;
const OPENAI_KEY = process.env.OPENAI_API_KEY?.replace(/['"]/g, '');

const SEARCH_QUERIES = ['속보', '주요뉴스', '경제이슈', '사회이슈', '화제'];

async function fetchNaverNews(query) {
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=10&sort=date`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': NAVER_ID,
      'X-Naver-Client-Secret': NAVER_SECRET,
    },
  });
  if (!res.ok) throw new Error(`네이버 API 오류: ${res.status}`);
  const data = await res.json();
  return data.items || [];
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#0*39;/g, "'");
}

function deduplicateByTitle(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.title.slice(0, 20);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchFullTitle(url, fallback) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(timer);
    const html = await res.text();
    const match = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (!match) return fallback;
    // 언론사명 접미사 제거 (예: " | 연합뉴스", " - MBC뉴스")
    return match[1].replace(/\s*[\||\-–—]\s*.{1,20}$/, '').trim() || fallback;
  } catch {
    return fallback;
  }
}

async function fetchArticleContent(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();

    // og:description 시도
    const ogMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
    if (ogMatch) return ogMatch[1].trim().slice(0, 1000);

    // <p> 태그 본문 추출
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

async function selectNewsWithGPT(newsList) {
  const today = new Date().toISOString().slice(0, 10);
  // 상위 20건만 전달, content_preview 포함
  const limited = newsList.slice(0, 20).map(item => ({
    title: item.title,
    content_preview: item.content.slice(0, 300),
    link: item.link,
  }));

  const prompt = `오늘 날짜: ${today}

다음 뉴스 목록을 보고 "오늘 한국인이라면 꼭 알아야 할 이슈" 1개를 선정해줘.
경제/정치/사회/IT를 골고루 고려하고, 국가적 파장이 큰 사건은 카테고리 상관없이 높은 점수를 줘.

【가산 기준】
- 화제성 +3: 빠르게 퍼지거나 많이 언급되는 이슈
- 임팩트 +2: 일반인 일상에 직접 영향 있는 이슈
- 이해쉬움 +1/-1: 쉽게 이해 가능하면 +1, 매우 전문적/복잡하면 -1
- 국내이슈 +1: 한국 관련 뉴스 우선
- 최신성 +1: 오늘/어제 발행 기사

【감점 기준】 (단, 국가적 파장이 크면 예외 적용)
- 교통사고·단순 사건사고 -2 (예외: 대형 재난급 사망자 다수 등)
- 연예인 가십·스캔들 -2 (예외: 국가적 이슈급)
- 단순 해외 뉴스 -1 (예외: 한국에 직접 영향 있는 경우)
- 날씨·자연재해 -2 (예외: 대규모 재난)
- 스포츠 경기 결과 -2 (예외: 올림픽·월드컵급)

title은 원문을 참고해 "..."없이 완전한 문장으로 재작성해줘.

아래 JSON 형식으로 응답해:
{
  "title": "뉴스 제목 (완전한 문장, ... 없이)",
  "tag": "오늘의 픽 · [카테고리한단어]",
  "emoji": "이모지1개",
  "summary": ["첫째 요약 문장 (~20자)", "둘째 요약 문장 (~20자)", "셋째 요약 문장 (~20자)"],
  "link": "원문URL",
  "score": 점수숫자,
  "date": "${today}"
}

뉴스 목록:
${JSON.stringify(limited, null, 2)}`;

  console.log('사용키:', OPENAI_KEY?.slice(-6));
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 800,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error('OpenAI 오류: ' + data.error.message);
  const content = data?.choices?.[0]?.message?.content || '';
  return JSON.parse(content);
}

async function main() {
  console.log('[뉴스 선정 시작]', new Date().toLocaleString('ko-KR'));

  if (!NAVER_ID || !NAVER_SECRET) {
    throw new Error('NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET 환경변수가 없습니다.');
  }
  if (!OPENAI_KEY) {
    throw new Error('OPENAI_API_KEY 환경변수가 없습니다.');
  }

  // 여러 키워드로 뉴스 수집
  const allItems = [];
  for (const query of SEARCH_QUERIES) {
    try {
      const items = await fetchNaverNews(query);
      allItems.push(...items);
      console.log(`  [${query}] ${items.length}건 수집`);
    } catch (e) {
      console.warn(`  [${query}] 수집 실패:`, e.message);
    }
  }

  // HTML 태그 제거 + 중복 제거
  const cleaned = allItems.map(item => ({
    title: stripHtml(item.title),
    description: stripHtml(item.description || ''),
    pubDate: item.pubDate,
    link: item.originallink || item.link,
  }));
  const unique = deduplicateByTitle(cleaned);
  console.log(`  총 ${unique.length}건 (중복 제거 후)`);

  // 잘린 제목(...으로 끝나는 것) 원문에서 보정
  const truncated = unique.filter(item => item.title.endsWith('...'));
  if (truncated.length > 0) {
    console.log(`  제목 보정 중... (${truncated.length}건)`);
    await Promise.all(truncated.map(async item => {
      item.title = await fetchFullTitle(item.link, item.title);
    }));
  }

  // 원문 본문 크롤링 (병렬) — 실패하거나 짧은 기사 제외
  console.log('  원문 크롤링 중...');
  const crawled = await Promise.all(
    unique.map(async item => {
      const content = await fetchArticleContent(item.link);
      return content ? { ...item, content } : null;
    })
  );
  const withContent = crawled.filter(Boolean);
  console.log(`  크롤링 성공: ${withContent.length}건 / ${unique.length}건`);
  if (withContent.length === 0) throw new Error('크롤링 성공한 뉴스가 없습니다.');

  // GPT로 핫이슈 선정
  console.log('  GPT-4o-mini 채점 중...');
  const selected = await selectNewsWithGPT(withContent);
  console.log(`  선정: [${selected.score}점] ${selected.title}`);

  // 선정된 뉴스의 크롤링 본문 첨부
  const matched = withContent.find(item => item.link === selected.link);
  if (matched) selected.content = matched.content;

  // today-news.json 저장
  const outPath = path.join(__dirname, 'today-news.json');
  fs.writeFileSync(outPath, JSON.stringify(selected, null, 2), 'utf-8');
  console.log(`  저장 완료: ${outPath}`);
  console.log('[완료]');
}

main().catch(e => {
  console.error('[에러]', e.message);
  process.exit(1);
});
