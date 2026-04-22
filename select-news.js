'use strict';

// Stage 1: 수집만 — Naver API 호출 + 필터링 → news_raw 저장 (크롤링 없음)

const { loadEnv }        = require('./loadEnv');
const { supabase }       = require('./supabase');
const { stripHtml }      = require('./stripHtml');
const { todayKST }       = require('./dateUtil');
const { isRedlineTitle } = require('./redline');
const { saveAutoLog }    = require('./redlineLog');

loadEnv();

const NAVER_ID     = (process.env.NAVER_CLIENT_ID     || '').replace(/[^\x20-\x7E]/g, '');
const NAVER_SECRET = (process.env.NAVER_CLIENT_SECRET || '').replace(/[^\x20-\x7E]/g, '');

// 타겟: 뉴스 잘 모르는 MZ. 시사 + 라이프 밸런스.
// 제거: 외교(속보·정치로 흡수), 안보(B-4 레드라인 직통), 금융/환율금리(전문·유료),
//       관세(트럼프 레드라인 직통), 기업·부동산(경제로 흡수).
// 추가: 사회·IT/AI·건강·환경·문화.
const QUERY_CONFIG = {
  '속보':   8,   // 긴급 이슈
  '정치':   7,   // 국내 정치
  '경제':   7,   // 경제·부동산·기업 흡수
  '사회':   7,   // 교육·복지·생활 (범죄는 레드라인 컷)
  'IT/AI':  7,   // 인공지능·반도체·빅테크
  '건강':   6,   // 의료·바이러스·생활건강
  '환경':   6,   // 기후·에너지·원전
  '문화':   5,   // 영화·음악·K팝·드라마
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


// URL 정규화: 트래킹 파라미터 제거, fragment/trailing slash 정리
const TRACKING_PREFIXES = ['utm_', 'fbclid', 'gclid', 'yclid', 'msclkid', 'ref', 'ref_', 'from'];
function normalizeUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PREFIXES.some(p => key.toLowerCase() === p || key.toLowerCase().startsWith(p + '_'))) {
        u.searchParams.delete(key);
      }
    }
    u.hash = '';
    return (u.origin + u.pathname + (u.search ? '?' + u.searchParams.toString() : '')).replace(/\/$/, '');
  } catch {
    return url;
  }
}

function deduplicateByUrl(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = normalizeUrl(item.link);
    if (seen.has(key)) return false;
    seen.add(key);
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

// 수집 단계 화이트리스트.
// 저작권 리스크 최우선. 기존 블랙리스트는 유료화 매체 추적 누락 위험이 있어
// 2026-04-22 화이트리스트로 전환했고, 이후 AI 학습·재가공 저작권 소송 동향을
// 반영해 공영방송(KBS·MBC·SBS)·검증 부족 전문지(전자신문·지디넷) 제외하고
// 공공저작물 3종을 추가. COPYRIGHT.md 참고.
//
// 매칭은 정확 호스트 또는 엄격 서브도메인 (host === d || host.endsWith('.' + d)).
// '.includes' 방식은 'malicious-kbs.co.kr' 같은 유사 호스트가 매치되는 스푸핑 리스크 있음.
//
// 네이버 뉴스 래퍼(news.naver.com / n.news.naver.com) 는 originallink 로 대체 판정
// — fetchNaverNews 에서 `raw.originallink || raw.link` 우선 사용.
//
// 2차 방어선: process-news.js 의 isInvalidContent 가 본문의 페이월/프리미엄 문구를 별도로
// 차단 — 화이트리스트 매체라도 유료 섹션 기사는 통과 안 됨.
const ALLOWED_DOMAINS = [
  // 공공저작물 (저작권법 제24조의2 자유이용)
  'korea.kr',              // 정책브리핑 (공공누리 라이선스)
  'sciencetimes.co.kr',    // 사이언스타임즈 (한국과학창의재단 운영)
  'science.ytn.co.kr',     // YTN 사이언스 (과기정통부+YTN 공동운영)
  // 통신사
  'yna.co.kr',             // 연합뉴스
  'news1.kr',              // 뉴스1
  'newsis.com',            // 뉴시스
  // 뉴스 전문
  'ytn.co.kr',             // YTN
  // IT 전문 — 사실전달 중심·AI 소송 비당사자로 저작권 리스크 상대적 낮음
  'etnews.com',            // 전자신문
  'zdnet.co.kr',           // 지디넷코리아
];

// 정확 매칭 또는 엄격 서브도메인 매칭. 'kbs.co.kr' 은 'kbs.co.kr' 과 '*.kbs.co.kr' 만 통과.
// 'malicious-kbs.co.kr' / 'fakekbs.co.kr' 같은 유사 호스트는 차단.
function isAllowedDomain(link) {
  try {
    const hostname = new URL(link).hostname.replace(/^www\./, '');
    return ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch {
    return false;
  }
}

const OPINION_WORDS = [
  '칼럼', '사설', '오피니언', '기고', '포럼', '시론', '논평',
  '특별기고', '데스크', '기자수첩', '독자투고', '단상',
];

// 단어를 포함해도 의견 기사가 아닌 복합 표현
const OPINION_EXCEPTIONS = ['오피니언 리더', '오피니언 리서치', '사설 대응', '칼럼 작성'];

function isOpinion(title) {
  if (title.includes('칼럼니스트')) return false;
  if (OPINION_EXCEPTIONS.some(e => title.includes(e))) return false;
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

  const today = todayKST();

  // 1. 키워드별 버킷 수집 + 필터 동시 적용
  const queryBuckets      = {};
  const overflowPool      = [];
  const redlineStats      = { total: 0, byReason: {} };
  const redlineBlockedLog = []; // [{ category, title, matched, url }]
  const redlinePassedLog  = []; // [{ title, url }]
  let   redlineInputCount = 0;  // 사전 필터 통과 후 redline 에 진입한 건수

  for (const query in QUERY_CONFIG) {
    const maxPerQuery = QUERY_CONFIG[query];
    try {
      const items = await fetchNaverNews(query);
      if (!queryBuckets[query]) queryBuckets[query] = [];

      for (const raw of items) {
        const title       = stripHtml(raw.title);
        const description = stripHtml(raw.description || '');
        const link        = raw.originallink || raw.link;

        if (SUMMARY_KEYWORDS.some(kw => title.replace(/\s/g, '').includes(kw))) continue;
        if (!isAllowedDomain(link)) continue;
        if (isOpinion(title)) continue;
        if (isWeakNews(title)) continue;

        redlineInputCount++;
        const redline = isRedlineTitle(title);
        if (redline.blocked) {
          redlineStats.total++;
          redlineStats.byReason[redline.reason] = (redlineStats.byReason[redline.reason] || 0) + 1;
          redlineBlockedLog.push({
            category: redline.reason.replace(/^redline_/, ''),
            title,
            matched: redline.matched,
            url: link,
          });
          console.log(`  🚫 [Redline] ${redline.reason} title="${title}"`);
          continue;
        }

        redlinePassedLog.push({ title, url: link });

        const item = { title, description, link };
        if (queryBuckets[query].length < maxPerQuery) {
          queryBuckets[query].push(item);
        } else {
          overflowPool.push(item);
        }
      }
      console.log(`  [${query}] ${queryBuckets[query].length}/${maxPerQuery}`);
    } catch (e) {
      console.warn(`  [${query}] 수집 실패:`, e.message);
    }
  }

  if (redlineStats.total > 0) {
    const breakdown = Object.entries(redlineStats.byReason)
      .map(([reason, count]) => `${reason.replace(/^redline_/, '')}:${count}`)
      .join(' / ');
    console.log(`  📊 [Redline 집계] 총 ${redlineStats.total}건 블록 / ${breakdown}`);
  } else {
    console.log(`  📊 [Redline 집계] 블록 없음`);
  }

  // Supabase redline_logs 에 auto_log 저장. 실패해도 Stage 1 진행에는 영향 없도록 try/catch.
  // user_notes / final_title 컬럼은 건드리지 않음 — 유저 메모와 Stage 2 갱신 값 보존.
  try {
    const { length } = await saveAutoLog(today, {
      collectedCount: redlineInputCount,
      blocked:        redlineBlockedLog,
      passed:         redlinePassedLog,
    });
    console.log(`  📝 [Redline 로그] Supabase 저장 완료 (auto_log ${length}자)`);
  } catch (e) {
    console.warn(`  ⚠️ [Redline 로그] 저장 실패:`, e.message);
  }

  // 2. 버킷 + overflow 전부 합친 뒤 impact 점수 순 top-30 (MIN_IMPACT 컷 없음 — GPT가 중요도 판단)
  const allItems = [];
  for (const key in queryBuckets) allItems.push(...queryBuckets[key]);
  allItems.push(...overflowPool);

  const scored = allItems.map(item => ({ ...item, impact: scoreImpactTitle(item.title, item.link) }));
  scored.sort((a, b) => b.impact - a.impact);
  const finalSelected = scored.slice(0, 30).map(({ impact, ...rest }) => rest);
  console.log(`  스코어링 후 top-30: ${finalSelected.length}건 / 전체 후보 ${allItems.length}건`);

  // 3. URL 기준 중복 제거
  const unique = deduplicateByUrl(finalSelected);
  console.log(`  필터+수집: ${unique.length}건`);

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

module.exports = {
  main, scoreImpactTitle,
  isAllowedDomain, ALLOWED_DOMAINS,
  QUERY_CONFIG, SUMMARY_KEYWORDS,
  isOpinion, isWeakNews,
  fetchNaverNews,
};

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
