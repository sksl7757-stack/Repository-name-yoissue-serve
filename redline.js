'use strict';

// Stage 1 redline — news_raw 적재 전 제목 기준 차단.
// 카테고리 A(윤리·법적) + B(편향 방어) 13개. 매칭 시 { blocked, reason } 리턴.
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
const single    = (kws)       => (title) => kws.some(kw => title.includes(kw));
const pair      = (req, wth)  => (title) => req.some(r => title.includes(r)) && wth.some(w => title.includes(w));
const anyCheck  = (...checks) => (title) => checks.some(c => c(title));

// ─── 카테고리 정의 ───────────────────────────────────────────────────────────
const REDLINE_CATEGORIES = [
  // ─── A (윤리·법적) ──────────────────────────────────────────────────────
  {
    name: 'suicide',
    check: single([
      '자살', '투신', '목을 매', '목매', '극단적 선택',
      '자살 시도', '자살률', '자해', '자살 기도', '음독',
      '유서 발견', '유서 남긴',
    ]),
    whitelist: [],
  },
  {
    name: 'minor_sex',
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
    check: single([
      '아동 포르노', '아청물', '아동성착취물', '아동음란물',
      '미성년자 음란물', '딥페이크 성범죄',
    ]),
    whitelist: [],
  },

  // ─── B (편향 방어) ──────────────────────────────────────────────────────
  {
    name: 'politicians',
    check: (title) => REDLINE_B_POLITICIANS.some(n => matchesPolitician(title, n)),
    whitelist: [],
  },
  {
    name: 'election',
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
      (title) => title.includes('공약') && ['대선', '후보', '선거'].some(k => title.includes(k)),
      // 조합: '캠프' + (선거/후보)
      (title) => title.includes('캠프') && ['선거', '후보'].some(k => title.includes(k)),
    ),
    whitelist: [],
  },
  {
    name: 'armed_conflict',
    check: single([
      // 고유명사
      '우크라이나 전쟁', '가자지구', '가자 전쟁',
      '하마스', '헤즈볼라', '이스라엘-하마스', '러시아-우크라이나',
      '팔레스타인', '레바논', '예멘', '시리아',
      // 일반 명사·동사
      '휴전', '교전', '공습', '폭격', '미사일 발사',
      '무력충돌', '침공', '전면전', '무기 지원', '전쟁범죄',
      '드론 공격', '드론 테러', '인질', '포로',
    ]),
    whitelist: [],
  },
  {
    name: 'nk_provoke',
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
    check: single([
      '이단', '사이비', '전광훈',
      'JMS', '신천지', '통일교', '천부교', '정명석',
      '교주', '포교 논란',
    ]),
    whitelist: [],
  },
  {
    name: 'sanctions',
    check: anyCheck(
      single(['대러 제재', '대이란 제재', '대북 제재', '제재 강화', '경제 제재']),
      // 조합: '수출통제' + B-1 POLITICIANS — "트럼프 대러 수출통제" 컷, "반도체 수출통제" 통과.
      (title) => title.includes('수출통제') &&
                 REDLINE_B_POLITICIANS.some(n => matchesPolitician(title, n)),
    ),
    whitelist: [],
  },
];

// ─── 공개 API ────────────────────────────────────────────────────────────────
// whitelist 가 먼저 매칭되면 해당 카테고리는 통과.
// 첫 매칭 카테고리로 reason 결정 (카테고리 순서가 우선순위).
function isRedlineTitle(title) {
  for (const cat of REDLINE_CATEGORIES) {
    if (cat.whitelist.length > 0 && cat.whitelist.some(w => title.includes(w))) continue;
    if (cat.check(title)) return { blocked: true, reason: `redline_${cat.name}` };
  }
  return { blocked: false, reason: null };
}

module.exports = {
  isRedlineTitle,
  REDLINE_CATEGORIES,
  REDLINE_B_POLITICIANS,
};
