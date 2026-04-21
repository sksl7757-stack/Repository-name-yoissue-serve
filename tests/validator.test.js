const { validate } = require('../validator');
const { PHASE } = require('../stateManager');

describe('validate — INIT phase', () => {
  test('FORCED_QUESTIONS[하나] 주입', () => {
    const out = validate({ reply: '이 뉴스 흥미롭네.', phase: PHASE.INIT, character: '하나' });
    expect(out.question).toBe('준혁이랑 나랑 생각이 좀 다른데, 너는 어느 쪽이야?');
    expect(out.message).toBe('이 뉴스 흥미롭네.');
  });

  test('FORCED_QUESTIONS[준혁] 주입', () => {
    const out = validate({ reply: '좀 복잡한 건수야.', phase: PHASE.INIT, character: '준혁' });
    expect(out.question).toBe('하나랑 나 입장이 다른데. 넌 어느 쪽으로 봐?');
  });

  test('unknown character → 하나 FORCED_QUESTIONS 폴백', () => {
    const out = validate({ reply: '내용.', phase: PHASE.INIT, character: '정체불명' });
    expect(out.question).toBe('준혁이랑 나랑 생각이 좀 다른데, 너는 어느 쪽이야?');
  });

  test('LLM 이 붙인 긴 질문은 message 에서 제거 (20자 초과 + "?" 끝)', () => {
    const reply = '오늘 경제 전망이 꽤 밝아 보여. 너는 이 정책 방향이 진짜로 효과를 낼 거라고 봐?';
    const out = validate({ reply, phase: PHASE.INIT, character: '하나' });
    expect(out.message).not.toContain('진짜로 효과를 낼 거라고 봐?');
    expect(out.message).toContain('경제 전망이 꽤 밝아 보여');
  });

  test('짧은 수사적 의문(20자 이하 + "?") 은 보존', () => {
    const reply = '느낌? 좀 그래.';
    const out = validate({ reply, phase: PHASE.INIT, character: '하나' });
    expect(out.message).toContain('느낌?');
  });
});

describe('validate — CHAT phase', () => {
  test('question = null', () => {
    const out = validate({ reply: '그 말도 일리가 있어.', phase: PHASE.CHAT, character: '하나' });
    expect(out.question).toBeNull();
    expect(out.message).toBe('그 말도 일리가 있어.');
  });

  test('긴 질문 제거', () => {
    const reply = '음 그래. 근데 진짜 그 정책이 잘 먹힌다고 생각하는 이유가 뭐야?';
    const out = validate({ reply, phase: PHASE.CHAT, character: '하나' });
    expect(out.message).not.toContain('잘 먹힌다고 생각하는 이유가 뭐야?');
    expect(out.question).toBeNull();
  });

  test('짧은 수사적 의문은 보존', () => {
    const reply = '진짜? 놀랍네.';
    const out = validate({ reply, phase: PHASE.CHAT, character: '준혁' });
    expect(out.message).toContain('진짜?');
  });
});

describe('validate — 추모 모드 (isMourning)', () => {
  test('phase 무관, question = null', () => {
    const init = validate({ reply: '오늘은 말이 조심스럽네.', phase: PHASE.INIT, character: '하나', isMourning: true });
    const chat = validate({ reply: '같이 기억하자.', phase: PHASE.CHAT, character: '준혁', isMourning: true });
    expect(init.question).toBeNull();
    expect(chat.question).toBeNull();
  });

  test('FORCED_QUESTIONS 미주입 — 대립 구도 회피', () => {
    const out = validate({ reply: '마음이 무겁네.', phase: PHASE.INIT, character: '하나', isMourning: true });
    expect(out.message).toBe('마음이 무겁네.');
    expect(out.question).toBeNull();
  });

  test('긴 질문은 여전히 제거', () => {
    const reply = '오늘은 조용히 가자. 다들 어떻게 지내고 계신지 한번 돌아보는 건 어때?';
    const out = validate({ reply, phase: PHASE.INIT, character: '준혁', isMourning: true });
    expect(out.message).not.toContain('한번 돌아보는 건 어때?');
  });
});

describe('validate — stripQuestions 안전장치', () => {
  test('응답 전체가 긴 질문이면 원본 반환 (빈 message 방지)', () => {
    const reply = '이 뉴스에 대해서 너는 진짜 어떻게 생각하는지 궁금한데?';
    const out = validate({ reply, phase: PHASE.CHAT, character: '하나' });
    expect(out.message.length).toBeGreaterThan(0);
  });

  test('여러 줄 응답 — 각 줄에서 긴 질문만 제거', () => {
    const reply = '오늘 뉴스 봤어.\n근데 정말 이 결과가 맞는 건지 너도 의심스럽지 않아?\n흥미로워.';
    const out = validate({ reply, phase: PHASE.CHAT, character: '하나' });
    expect(out.message).toContain('오늘 뉴스 봤어');
    expect(out.message).toContain('흥미로워');
    expect(out.message).not.toContain('의심스럽지 않아?');
  });
});

describe('validate — stance 대립 유지', () => {
  test('하나/준혁 FORCED_QUESTIONS 는 서로 상대 이름을 참조 (퀵리플라이 연결)', () => {
    const hana = validate({ reply: 'x', phase: PHASE.INIT, character: '하나' });
    const junhyuk = validate({ reply: 'x', phase: PHASE.INIT, character: '준혁' });
    expect(hana.question).toContain('준혁');
    expect(junhyuk.question).toContain('하나');
  });
});
