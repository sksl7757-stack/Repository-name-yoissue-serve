'use strict';

// Stage 1 redline — news_raw 적재 전 제목 기준 차단.
// 카테고리 A(윤리·법적) + B(편향 방어) 13개. 매칭 시 { blocked, reason, matched } 리턴.
// 유지보수 메모는 REDLINE.md 참고.

// ─── B-1 POLITICIANS 리스트 ──────────────────────────────────────────────────
// 월 1회 정기 리뷰 + 개각/당 대표 교체/대선·총선/정권 교체/탄핵·사임 이벤트 트리거 리뷰.
// 초안 기준: 2026-04-22.
const REDLINE_B_POLITICIANS = [
  // 전·현직 대통령
  '이재명', '윤석열', '문재인', '박근혜', '이명박',
  // 국무총리
  '김민석',
  // 민주당
  '박찬대', '정청래', '우원식', '추미애',
  // 국민의힘
  '김용태', '한동훈', '홍준표', '오세훈',
  '나경원', '유승민', '원희룡', '김문수',
  '장동혁', '송언석',
  // 제3지대
  '이준석', '천하람', '안철수', '조국', '김선민',
  // 영부인
  '김혜경', '김건희',
  // 해외
  '트럼프', '바이든', '해리스', '푸틴', '시진핑',
  '김정은', '네타냐후', '젤렌스키',
];

// '조국' 은 일반명사와 충돌. 한국어 조사/공백/구두점/문장끝 lookahead 로 경계 매칭.
// '조국수호단' 같은 복합어는 매칭 제외.
// 한계: "우리 조국의 미래" 처럼 일반명사 + 조사 문장은 여전히 매치됨 — 의도된 false positive 감수.
const JOGUK_PATTERN = /조국(?=[은는이가을를의에과와도로및]|\s|[,.!?()[\]]|$)/;

function matchesPolitician(title, name) {
  if (name === '조국') return JOGUK_PATTERN.test(title);
  return title.includes(name);
}

// ─── 매칭 헬퍼 ───────────────────────────────────────────────────────────────
// 매치되면 키워드 문자열(또는 조합) 반환, 아니면 null.
const single    = (kws)       => (title) => kws.find(kw => title.includes(kw)) || null;
const pair      = (req, wth)  => (title) => {
  const r = req.find(x => title.includes(x));
  if (!r) return null;
  const w = wth.find(x => title.includes(x));
  return w ? `${r}+${w}` : null;
};
const anyCheck  = (...checks) => (title) => {
  for (const c of checks) {
    const m = c(title);
    if (m) return m;
  }
  return null;
};

// ─── C (혐오·차별) 공통 whitelist ─────────────────────────────────────────
// 보도·비판·인권 맥락을 과차단하지 않기 위한 공통 키셋. 각 C 카테고리에서 참조.
const HATE_COMMON_WHITELIST = [
  '차별 금지', '차별금지법', '혐오 표현', '혐오표현 규제',
  '비판', '규탄', '비난 여론', '사과', '논란', '피해자',
  '인권', '인권위', '권리 보호', '보호법', '처벌', '처벌 강화',
];

// ─── 카테고리 정의 ───────────────────────────────────────────────────────────
const REDLINE_CATEGORIES = [
  // ─── A (윤리·법적) ──────────────────────────────────────────────────────
  {
    name: 'suicide',
    label: 'A-1 자살',
    check: single([
      '자살', '투신', '목을 매', '목매', '극단적 선택',
      '자살 시도', '자살률', '자해', '자살 기도', '음독',
      '유서 발견', '유서 남긴',
    ]),
    whitelist: [],
  },
  {
    name: 'minor_sex',
    label: 'A-2 미성년성범죄',
    check: pair(
      ['미성년', '미성년자', '아동', '청소년',
       '초등학생', '중학생', '고등학생', '10대',
       '어린이', '유아', 'N번방'],
      ['성폭행', '성추행', '성착취', '성범죄', '성폭력',
       '그루밍', '성매매', '강간', '디지털성범죄',
       '몰카', '불법촬영', '유포'],
    ),
    whitelist: [],
  },
  {
    name: 'brutal_crime',
    label: 'A-3 잔혹범죄',
    check: single([
      '토막살인', '시신 훼손', '시신 유기', '사지 절단',
      '잔혹 살해', '엽기 살해', '보복 살해',
      '흉기 난동', '흉기 휘두른', '흉기 피습', '흉기로 찌른',
      '묻지마 살인', '연쇄 살인', '시신 방치',
    ]),
    whitelist: [],
  },
  {
    name: 'minor_sexual',
    label: 'A-4 아청물',
    check: single([
      '아동 포르노', '아청물', '아동성착취물', '아동음란물',
      '미성년자 음란물', '딥페이크 성범죄',
    ]),
    whitelist: [],
  },
  {
    name: 'sexual_product',
    label: 'A-5 성인제품',
    check: single([
      '콘돔',
    ]),
    whitelist: [],
  },

  // ─── B (편향 방어) ──────────────────────────────────────────────────────
  {
    name: 'politicians',
    label: 'B-1 정치인',
    check: (title) => REDLINE_B_POLITICIANS.find(n => matchesPolitician(title, n)) || null,
    whitelist: [],
  },
  {
    name: 'election',
    label: 'B-2 선거',
    check: anyCheck(
      single([
        '총선', '대선', '지방선거', '재보궐', '재보궐선거',
        '공천', '경선', '후보 등록', '선거운동', '투표율',
        '개표', '출구조사', '공직선거법', '선거구',
        '당선', '낙선', '사전투표', 'TV토론', '후보 토론',
        '선관위', '중앙선거관리위원회',
        '정당 지지율', '비례대표', '국회의장', '원내대표',
      ]),
      // 조합: '공약' + (대선/후보/선거)
      (title) => {
        if (!title.includes('공약')) return null;
        const k = ['대선', '후보', '선거'].find(x => title.includes(x));
        return k ? `공약+${k}` : null;
      },
      // 조합: '캠프' + (선거/후보)
      (title) => {
        if (!title.includes('캠프')) return null;
        const k = ['선거', '후보'].find(x => title.includes(x));
        return k ? `캠프+${k}` : null;
      },
    ),
    whitelist: [],
  },
  {
    name: 'armed_conflict',
    label: 'B-3 무력분쟁',
    check: single([
      // 고유명사
      '우크라이나 전쟁', '가자지구', '가자 전쟁',
      '하마스', '헤즈볼라', '이스라엘-하마스', '러시아-우크라이나',
      '팔레스타인', '레바논', '예멘', '시리아',
      // 일반 명사·동사
      '휴전', '종전', '교전', '공습', '폭격', '미사일 발사',
      '무력충돌', '침공', '전면전', '무기 지원', '전쟁범죄',
      '드론 공격', '드론 테러', '인질', '포로',
    ]),
    whitelist: [],
  },
  {
    name: 'nk_provoke',
    label: 'B-4 북한도발',
    check: pair(
      ['북한', '김정은', '김여정', '평양',
       '조선중앙통신', '조선로동당', '조선인민군', '노동신문'],
      ['미사일', '도발', '핵실험', 'ICBM', 'SLBM',
       '포격', '발사', '위협', '핵무기',
       '순항미사일', '탄도미사일',
       '무인기 침범', '해킹', '도발적 행위'],
    ),
    whitelist: [],
  },
  {
    name: 'historical',
    label: 'B-5 역사현안',
    check: single([
      '친일', '친일파', '강제동원', '강제징용', '위안부',
      '5·18', '5.18', '광주민주화',
      '제주 4·3', '제주 4.3',
      '세월호', '이태원 참사',
      '반일', '반중',
      '일제 강점기', '식민지',
      '친북', '종북',
      '역사 왜곡', '독도', '일본군',
    ]),
    whitelist: [],
  },
  {
    name: 'trial_investigation',
    label: 'B-6 수사재판',
    check: single([
      '검찰 수사', '경찰 수사', '압수수색', '구속영장',
      '기소', '선고', '항소심', '상고심',
      '특검', '특별수사', '구속 기소', '불구속 기소',
      '내란죄', '뇌물 수수', '수사 착수', '소환 조사',
      '영장 실질심사', '공판', '집행유예', '국정조사',
    ]),
    whitelist: [
      '수사권 조정', '제도 개선', '법 개정', '법률 개정',
      '법안 발의', '연구 발표', '정책 발표', '대책 발표',
    ],
  },
  {
    name: 'faction_clash',
    label: 'B-7 진영갈등',
    check: anyCheck(
      single([
        '여야 충돌', '여야 공방', '정쟁',
        '좌빨', '수꼴', '적폐',
        '이념갈등', '진영 논리',
        '친노', '친문', '친명', '친박',
        '친윤', '반윤', '비윤',
      ]),
      pair(
        ['좌파', '우파', '보수', '진보'],
        ['vs', '공격', '결집', '대립', '충돌', '갈등',
         '선동', '프레임', '포퓰리즘', '책임'],
      ),
    ),
    whitelist: [],
  },
  {
    name: 'religion_eval',
    label: 'B-8 종교평가',
    check: single([
      '이단', '사이비', '전광훈',
      'JMS', '신천지', '통일교', '천부교', '정명석',
      '교주', '포교 논란',
    ]),
    whitelist: [],
  },
  {
    name: 'sanctions',
    label: 'B-9 제재',
    check: anyCheck(
      single(['대러 제재', '대이란 제재', '대북 제재', '제재 강화', '경제 제재']),
      // 조합: '수출통제' + B-1 POLITICIANS — "트럼프 대러 수출통제" 컷, "반도체 수출통제" 통과.
      // (B-1 이 카테고리 순서상 앞이라 실제로는 politicians 로 먼저 잡힘 — 백업 경로)
      (title) => {
        if (!title.includes('수출통제')) return null;
        const p = REDLINE_B_POLITICIANS.find(n => matchesPolitician(title, n));
        return p ? `수출통제+${p}` : null;
      },
    ),
    whitelist: [],
  },

  // ─── C (혐오·차별, 2026-04-24 추가) ────────────────────────────────────
  // 공통 whitelist: 비판·보도·인권·규탄 맥락은 통과. 기사가 혐오 표현 자체를 다루는
  // (차별 금지·인권·비판 등) 경우 과차단 방지. 카테고리별로 추가 whitelist 가능.
  //
  // 적용 범위: isRedlineTitle (Stage 1 제목) + detectHateContent (본문/채팅/출력).
  // 개별 정치인·역사 용어와 달리 혐오 표현은 본문에 더 자주 등장해 본문 패스도 필요.
  {
    name: 'disability_hate',
    label: 'C-1 장애비하',
    check: single([
      '병신', '저능아', '정박아', '애자', '장애자', '절름발이', '귀머거리',
    ]),
    whitelist: HATE_COMMON_WHITELIST,
  },
  {
    name: 'lgbtq_hate',
    label: 'C-2 성소수자혐오',
    check: anyCheck(
      single(['호모새끼', '게이새끼', '레즈년']),
      // 중립어 + 혐오 술어 조합. "성소수자 치료" / "동성애 질병" 등 비하 프레임.
      pair(
        ['성소수자', '게이', '레즈비언', '트랜스젠더', '동성애'],
        ['혐오', '치료', '교정', '변태', '질병'],
      ),
    ),
    whitelist: HATE_COMMON_WHITELIST,
  },
  {
    name: 'race_nationality_hate',
    label: 'C-3 인종국적비하',
    check: single([
      '짱깨', '쪽발이', '쪽바리', '깜둥이', '니그로', '개슬람', '조센징',
    ]),
    whitelist: HATE_COMMON_WHITELIST,
  },
  {
    name: 'region_hate',
    label: 'C-4 지역비하',
    // '홍어' 단독은 식재료 오탐 위험 — '홍어족'/'홍어냄새' 같은 compound slur 만.
    check: single([
      '전라디언', '경상디언', '개쌍도', '깽깽이', '홍어족', '홍어냄새',
    ]),
    whitelist: HATE_COMMON_WHITELIST,
  },
  {
    name: 'appearance_body_shaming',
    label: 'C-5 외모비하',
    // 단일 슬러(뚱보·돼지 등)는 일상어 오탐이 커 pair 로만. 중립 명사 + 조롱 술어.
    check: pair(
      ['외모', '몸매', '얼굴', '뚱뚱', '살찐', '못생긴', '체형'],
      ['비하', '조롱', '놀림', '희화화', '비난'],
    ),
    whitelist: [...HATE_COMMON_WHITELIST, '외모지상주의', '외모 평가'],
  },
];

// ─── 한국어 라벨 맵 (redlineLog 등 외부에서 카테고리 한국어명 조회용) ─────────
const CATEGORY_LABELS = REDLINE_CATEGORIES.reduce((acc, cat) => {
  acc[cat.name] = cat.label;
  return acc;
}, {});

// ─── 공개 API ────────────────────────────────────────────────────────────────
// whitelist 가 먼저 매칭되면 해당 카테고리는 통과.
// 첫 매칭 카테고리로 reason 결정 (카테고리 순서가 우선순위).
// matched: 매칭된 키워드 문자열 (single) 또는 조합 (pair/combo: "a+b").
function isRedlineTitle(title) {
  for (const cat of REDLINE_CATEGORIES) {
    if (cat.whitelist.length > 0 && cat.whitelist.some(w => title.includes(w))) continue;
    const matched = cat.check(title);
    if (matched) return { blocked: true, reason: `redline_${cat.name}`, matched };
  }
  return { blocked: false, reason: null, matched: null };
}

// ─── 혐오·차별 감지 (C 카테고리만, 제목+본문 공용) ──────────────────────────
// - 뉴스 본문(process-news Stage 2), 채팅 입력(/chat), LLM 출력(outputGuard) 공용.
// - isRedlineTitle 은 A/B/C 전체 순차 매칭 — 제목 레벨 정치·선거도 차단.
// - detectHateContent 는 C 만 골라 검사 — 정치 키워드 혼재하는 일반 본문·발화에서
//   정치 매치 오탐 없이 혐오만 잡는다.
const HATE_CATEGORY_NAMES = new Set([
  'disability_hate', 'lgbtq_hate', 'race_nationality_hate',
  'region_hate', 'appearance_body_shaming',
]);

function detectHateContent(text) {
  if (!text || typeof text !== 'string') return { detected: false, category: null, matched: null };
  for (const cat of REDLINE_CATEGORIES) {
    if (!HATE_CATEGORY_NAMES.has(cat.name)) continue;
    if (cat.whitelist.length > 0 && cat.whitelist.some(w => text.includes(w))) continue;
    const matched = cat.check(text);
    if (matched) return { detected: true, category: cat.name, matched };
  }
  return { detected: false, category: null, matched: null };
}

module.exports = {
  isRedlineTitle,
  detectHateContent,
  REDLINE_CATEGORIES,
  REDLINE_B_POLITICIANS,
  CATEGORY_LABELS,
};
