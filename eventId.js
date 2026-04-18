'use strict';

// eventId 생성: subject_action_object
// 뉴스 기사를 "사건 단위"로 묶기 위한 식별값

// ─── 주체 키워드 목록 ──────────────────────────────────────────────────────────

const COMPANY_KEYWORDS = [
  '삼성', '애플', '구글', '마이크로소프트', '메타', '테슬라', '엔비디아', '인텔', 'AMD', 'TSMC',
  'SK', 'LG', '현대', '기아', '포스코', '롯데', '한화', '두산', '금호', '효성',
  '카카오', '네이버', '쿠팡', '크래프톤', '넥슨', '배달의민족', '토스',
  '아마존', '우버', '에어비앤비', 'KT',
  '우리은행', '국민은행', '신한', '하나은행', 'KB',
];

const GOV_KEYWORDS = [
  '정부', '한국은행', '국회', '청와대', '대통령실', '대통령',
  '금융위', '금감원', '법원', '검찰', '경찰', '국세청', '공정위',
  '기재부', '교육부', '복지부', '외교부', '국방부', '환경부', '국토부', '산업부', '고용부',
  '연준', 'FED', 'IMF', 'WTO', 'UN',
  '미국', '중국', '일본', '러시아', '북한', '유럽', '이란',
  '트럼프', '바이든', '시진핑', '푸틴',
];

// ─── action 고정 매핑 (우선순위 순) ─────────────────────────────────────────────

const ACTION_MAP = [
  { keywords: ['투자', '확대', '자금'],  action: 'invest'      },
  { keywords: ['발표', '공개'],          action: 'announce'    },
  { keywords: ['인상', '상승'],          action: 'increase'    },
  { keywords: ['인하', '하락'],          action: 'decrease'    },
  { keywords: ['진출', '출시'],          action: 'launch'      },
  { keywords: ['계약', '협력'],          action: 'deal'        },
  { keywords: ['규제', '제재'],          action: 'regulate'    },
  { keywords: ['사고', '참사'],          action: 'incident'    },
  { keywords: ['수사', '조사'],          action: 'investigate' },
];

// ─── 정규화 ──────────────────────────────────────────────────────────────────

function normalize(str) {
  return str
    .replace(/\s+/g, '')
    .replace(/[^\wㄱ-힣]/g, '')
    .toLowerCase();
}

// ─── subject 추출 ────────────────────────────────────────────────────────────

function extractSubject(title) {
  // 1순위: 기업
  for (const kw of COMPANY_KEYWORDS) {
    if (title.includes(kw)) return normalize(kw);
  }
  // 2순위: 정부/기관/인물
  for (const kw of GOV_KEYWORDS) {
    if (title.includes(kw)) return normalize(kw);
  }
  // 3순위: 제목 첫 토큰 (2~6자)
  const firstToken = title.split(/[\s,·\-–—[\]()「」『』<>《》【】]+/)[0] || '';
  if (firstToken.length >= 2 && firstToken.length <= 6) {
    return normalize(firstToken);
  }
  return 'unknown';
}

// ─── action 추출 ────────────────────────────────────────────────────────────

function extractAction(title) {
  for (const { keywords, action } of ACTION_MAP) {
    if (keywords.some(kw => title.includes(kw))) return action;
  }
  return 'unknown';
}

// ─── object 추출 ────────────────────────────────────────────────────────────
// 한국어 SOV 어순 → action 키워드 바로 앞 명사가 object

function extractObject(title, mainKeyword) {
  // mainKeyword 우선 사용
  if (mainKeyword) return normalize(mainKeyword);

  // action 키워드 이전 단어 탐색
  for (const { keywords } of ACTION_MAP) {
    for (const kw of keywords) {
      const idx = title.indexOf(kw);
      if (idx <= 0) continue;
      const before = title.slice(0, idx).trim();
      const tokens = before.split(/[\s,·\-–—[\]()「」『』<>《》【】]+/).filter(t => t.length >= 2);
      if (tokens.length > 0) {
        return normalize(tokens[tokens.length - 1]);
      }
    }
  }

  // 위에서 못 찾으면 제목 마지막 유의미한 단어
  const tokens = title.split(/[\s,·\-–—[\]()「」『』<>《》【】]+/).filter(t => t.length >= 2);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const n = normalize(tokens[i]);
    if (n && !/^\d+$/.test(n)) return n;
  }
  return 'unknown';
}

// ─── 공개 API ────────────────────────────────────────────────────────────────

/**
 * eventId 생성
 * @param {object} item        - { title }
 * @param {string} [mainKeyword] - analyzeTrend() 의 mainKeyword (object 추출 우선)
 * @returns {string}  예: "삼성_invest_AI"
 */
function generateEventId(item, mainKeyword) {
  const title   = item.title || '';
  const subject = extractSubject(title);
  const action  = extractAction(title);
  const obj     = extractObject(title, mainKeyword || null);
  return `${subject}_${action}_${obj}`;
}

module.exports = { generateEventId };
