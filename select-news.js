'use strict';

// Stage 1: 수집만 — Naver API 호출 + 필터링 → news_raw 저장 (크롤링 없음)

const { loadEnv }   = require('./loadEnv');
const { supabase }  = require('./supabase');
const { stripHtml } = require('./stripHtml');

loadEnv();

const NAVER_ID     = (process.env.NAVER_CLIENT_ID     || '').replace(/[^\x20-\x7E]/g, '');
const NAVER_SECRET = (process.env.NAVER_CLIENT_SECRET || '').replace(/[^\x20-\x7E]/g, '');

const QUERY_CONFIG = {
  '속보':     8,   // 긴급 이슈
  '외교':     6,   // 국제/외교
  '안보':     6,   // 안보/군사
  '정치':     6,   // 국내 정치
  '경제':     5,   // 경제 전반
  '금융':     5,   // 금융 시장
  '환율금리': 5,   // 환율/금리
  '관세':     4,   // 무역/관세
  '기업':     5,   // 기업 이슈
  '부동산':   4,   // 부동산
};

async function fetchNaverNews(query) {
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=10&sort=date`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id':     NAVER_ID,
      'X-Naver-Client-Secret': NAVER_SECRET,
    },
  });
  if (!res.ok) throw new Error(`네이버 API 오류: ${res.status}`);
  const data = await res.json();
  return data.items || [];
}


function deduplicateByUrl(items) {
  const seen = new Set();
  return items.filter(item => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
}

const SUMMARY_KEYWORDS = [
  // 기존
  '이슈종합', '뉴스종합', '뉴스브리핑', '오늘의뉴스', '주요뉴스종합', '헤드라인종합',
  // 묶음 기사 패턴
  '위클리PICK', '주간PICK', '주간이슈', '이주의이슈', '한눈에',
  'TOP5', 'TOP3', 'TOP10',
  '핫이슈모음', '이슈모아', '모아보기',
  // 방송사·통신사 뉴스 종합 포맷 ("BBC도 주요 뉴스로 전한 늑구" 오탐 방지 — 좁은 패턴만)
  '이시각주요뉴스', '오늘의주요뉴스', '뉴스센터주요뉴스',
  // 뉴스레터/바이트 형식
  '뉴스바이트', '뉴스레터',
  // 언론사 사설 종합 (미디어오늘 류)
  '사설종합', '언론사설', '오늘의사설',
];

// 언론 비평·큐레이션 전문 매체 — 단독 뉴스 소스로 부적합
const BLOCKED_DOMAINS = [
  'mediatoday.co.kr',  // 미디어오늘
  'mediawatch.kr',     // 미디어워치
];

function isBlockedDomain(link) {
  try {
    const hostname = new URL(link).hostname.replace(/^www\./, '');
    return BLOCKED_DOMAINS.some(d => hostname.includes(d));
  } catch {
    return false;
  }
}

const OPINION_WORDS = [
  '칼럼', '사설', '오피니언', '기고', '포럼', '시론', '논평',
  '특별기고', '데스크', '기자수첩', '독자투고', '단상',
];

function isOpinion(title) {
  if (title.includes('칼럼니스트')) return false;
  // 제목 맨 앞 대괄호 안에 오피니언 단어가 있을 때만 제외
  // 예: "[칼럼] ...", "[기자수첩] ..." → 제외
  // 예: "기자수첩으로 본 트럼프 관세" → 유지
  const bracketMatch = title.match(/^\[([^\]]+)\]/);
  if (bracketMatch) {
    const bracketContent = bracketMatch[1];
    return OPINION_WORDS.some(word => bracketContent.includes(word));
  }
  // 대괄호 없으면 칼럼/사설/오피니언 단어만 제외
  const STRONG_OPINION = ['칼럼', '사설', '오피니언'];
  return STRONG_OPINION.some(word => title.includes(word));
}

const WEAK_PATTERNS = [
  '포럼 개최', '행사 개최', '세미나 개최',
  // '간담회' 제거 — "국방부 긴급 간담회" 같은 중요 이슈 걸릴 수 있음
  '심포지엄', '컨퍼런스', '설명회', '기념식', '출범식',
];

function isWeakNews(title) {
  return WEAK_PATTERNS.some(pattern => title.includes(pattern));
}

function getQueryKey(query) {
  return query;
}

// 주요 전국 매체 — 소스 가중치 1.0
const MAJOR_SOURCES = [
  // 통신사
  'yna.co.kr', 'yonhapnewstv.co.kr', 'newsis.com', 'news1.kr',
  // 방송
  'ytn.co.kr', 'kbs.co.kr', 'mbc.co.kr', 'sbs.co.kr',
  'jtbc.co.kr', 'tvchosun.com', 'mbn.co.kr', 'ichannela.com',
  // 일간지
  'chosun.com', 'joins.com', 'joongang.co.kr',
  'donga.com', 'hani.co.kr', 'khan.co.kr',
  'hankookilbo.com', 'kmib.co.kr', 'segye.com', 'munhwa.com',
  // 경제지
  'hankyung.com', 'mk.co.kr', 'sedaily.com',
  'edaily.co.kr', 'mt.co.kr', 'fnnews.com', 'asiae.co.kr',
  // 기타 전국 매체
  'nocutnews.co.kr', 'ohmynews.com', 'pressian.com', 'heraldcorp.com',
];

function getSourceWeight(url) {
  if (!url) return 0.7;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    if (MAJOR_SOURCES.some(d => hostname.includes(d))) return 1.0;
    return 0.6; // 지방지/소규모 매체
  } catch {
    return 0.7;
  }
}

function scoreImpactTitle(title, url) {
  let score = 0;
  const STRONG_KEYWORDS    = [
    // 경제
    '금리', '환율', '관세', '반도체', 'AI', '인공지능', '경제', '물가', '수출',
    // 국제 정세
    '트럼프', '푸틴', '시진핑', '이란', '북한', '러시아', '중동', '전쟁', '핵실험', '미사일',
    // 정치
    '대통령', '탄핵', '총선', '개각',
    // 재해/사고
    '사망', '참사', '붕괴',
  ];
  const IMPORTANT_ENTITIES = ['삼성', '애플', '구글', '정부', '미국', '중국'];
  const CHANGE_WORDS       = ['상승', '하락', '급등', '급락', '충격', '위기'];

  // STRONG_KEYWORDS 2→1 감경 (지자체 보도자료 과대평가 방지)
  for (const k of STRONG_KEYWORDS)    if (title.includes(k)) score += 1;
  for (const e of IMPORTANT_ENTITIES) if (title.includes(e)) score += 1;
  for (const c of CHANGE_WORDS)       if (title.includes(c)) score += 1;

  return score * getSourceWeight(url);
}

async function main() {
  const start = Date.now();
  console.log('🚀 [Stage 1] select-news 시작:', new Date().toISOString());

  if (!NAVER_ID || !NAVER_SECRET) throw new Error('NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET 환경변수 없음');

  const today = new Date().toISOString().slice(0, 10);

  // 1. 키워드별 버킷 수집 + 필터 동시 적용
  const MAX_TOTAL    = 50;
  const queryBuckets = {};
  const overflowPool = [];

  for (const query in QUERY_CONFIG) {
    const maxPerQuery = QUERY_CONFIG[query];
    try {
      const items = await fetchNaverNews(query);
      const key = getQueryKey(query);
      if (!queryBuckets[key]) queryBuckets[key] = [];

      for (const raw of items) {
        const title       = stripHtml(raw.title);
        const description = stripHtml(raw.description || '');
        const link        = raw.originallink || raw.link;

        if (SUMMARY_KEYWORDS.some(kw => title.replace(/\s/g, '').includes(kw))) continue;
        if (isBlockedDomain(link)) continue;
        if (isOpinion(title)) continue;
        if (isWeakNews(title)) continue;

        const item = { title, description, link };
        if (queryBuckets[key].length < maxPerQuery) {
          queryBuckets[key].push(item);
        } else {
          overflowPool.push(item);
        }
      }
      console.log(`  [${query}] ${queryBuckets[key].length}/${maxPerQuery}`);
    } catch (e) {
      console.warn(`  [${query}] 수집 실패:`, e.message);
    }
  }

  // 2. 최종 후보 구성 (키워드별 → overflow 보충 → MAX_TOTAL 컷)
  let finalItems = [];
  for (const key in queryBuckets) finalItems.push(...queryBuckets[key]);
  if (finalItems.length < MAX_TOTAL) {
    for (const item of overflowPool) {
      finalItems.push(item);
      if (finalItems.length >= MAX_TOTAL) break;
    }
  }
  finalItems = finalItems.slice(0, MAX_TOTAL);

  // 2-1. impact 점수 순 정렬 후 상위 30개 (MIN_IMPACT 컷 제거 — GPT가 직접 중요도 판단)
  const scored = finalItems.map(item => ({ ...item, impact: scoreImpactTitle(item.title, item.link) }));
  scored.sort((a, b) => b.impact - a.impact);
  const finalSelected = scored.slice(0, 30).map(({ impact, ...rest }) => rest);
  console.log(`  최종 30개 선정: ${finalSelected.length}건`);

  // 3. URL 기준 중복 제거
  const unique = deduplicateByUrl(finalSelected);
  console.log(`  필터+수집: ${unique.length}건 (버킷합계 ${finalItems.length}건)`);

  if (unique.length === 0) throw new Error('필터링 후 남은 뉴스 없음');

  // 4. upsert — 중복 URL은 skip
  const rows = unique.map(item => ({
    date:        today,
    title:       item.title,
    url:         item.link,
    description: item.description || '',
    processed:   false,
  }));

  const { data: inserted, error } = await supabase
    .from('news_raw')
    .upsert(rows, { onConflict: 'url', ignoreDuplicates: true })
    .select();

  if (error) throw new Error('news_raw 저장 오류: ' + error.message);

  const insertedCount = inserted ? inserted.length : 0;
  const skippedCount  = rows.length - insertedCount;
  console.log(`  insert: ${insertedCount}건 / skip(중복): ${skippedCount}건`);

  console.log(`✅ [Stage 1] 완료: ${Date.now() - start}ms`);
}

module.exports = { main, scoreImpactTitle };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
