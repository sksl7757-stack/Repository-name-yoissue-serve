'use strict';

const INTENT = { EXPLAIN: 'EXPLAIN', OPINION: 'OPINION', CHAT: 'CHAT' };

const EXPLAIN_PATTERNS = [
  /(.+?)[이가은는을를]?\s*(뭐야|뭔데|뭔지|뭐야\?|뭔가요|뭔지\s*모르겠어|무슨\s*뜻이야|무슨\s*말이야|무엇인가|무엇인지|설명해줘|알려줘)(\?|！|!)?$/,
  /(.+?)\s*(뜻이\s*뭐야|가\s*뭔지|이\s*뭔지)(\?|！|!)?$/,
];

const EXPLAIN_SUFFIXES = [
  '뭐야', '뭔데', '뭔지', '무슨 뜻이야', '무슨 말이야', '무엇인가', '무엇인지',
  '설명해줘', '알려줘', '뜻이 뭐야', '뭔지 모르겠어',
];

const OPINION_SUFFIXES = [
  '어떻게 생각해', '어떻게 봐', '어떻게 될까', '어떻게 될 것 같아',
  '어떤 것 같아', '어떨 것 같아',
  '괜찮을까', '어떡하지', '어떡할까', '어떨까', '좋을까', '나쁠까', '일까',
];

const OPINION_PATTERNS = [
  /어떻게\s*(생각해|봐|될\s*것\s*같아|될까|볼까|보여)(\?|？)?/,
  /어떤\s*(것\s*같아|느낌이야|상황이야)(\?|？)?/,
  /일까(\?|？)?\s*$/,
];

function classifyIntent(userInput) {
  if (!userInput || typeof userInput !== 'string') return INTENT.CHAT;

  const input = userInput.trim();

  // EXPLAIN: suffix matching (more reliable than regex for Korean morphology)
  for (const suffix of EXPLAIN_SUFFIXES) {
    if (input.includes(suffix)) return INTENT.EXPLAIN;
  }
  // EXPLAIN: pattern matching
  for (const pattern of EXPLAIN_PATTERNS) {
    if (pattern.test(input)) return INTENT.EXPLAIN;
  }

  // OPINION: suffix matching
  for (const suffix of OPINION_SUFFIXES) {
    if (input.includes(suffix)) return INTENT.OPINION;
  }
  // OPINION: pattern matching
  for (const pattern of OPINION_PATTERNS) {
    if (pattern.test(input)) return INTENT.OPINION;
  }

  return INTENT.CHAT;
}

module.exports = { classifyIntent, INTENT };
