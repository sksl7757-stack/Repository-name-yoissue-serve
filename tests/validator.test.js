const { validate } = require('../validator');

describe('validate — 긴 질문 제거', () => {
  test('단순 응답 그대로 반환', () => {
    const out = validate({ reply: '이 뉴스 흥미롭네.' });
    expect(out.message).toBe('이 뉴스 흥미롭네.');
  });

  test('LLM 이 붙인 긴 질문은 제거 (20자 초과 + "?" 끝)', () => {
    const reply = '오늘 경제 전망이 꽤 밝아 보여. 너는 이 정책 방향이 진짜로 효과를 낼 거라고 봐?';
    const out = validate({ reply });
    expect(out.message).not.toContain('진짜로 효과를 낼 거라고 봐?');
    expect(out.message).toContain('경제 전망이 꽤 밝아 보여');
  });

  test('짧은 수사적 의문(20자 이하 + "?") 은 보존', () => {
    const reply = '느낌? 좀 그래.';
    const out = validate({ reply });
    expect(out.message).toContain('느낌?');
  });

  test('짧은 수사적 의문 — "진짜?" 보존', () => {
    const reply = '진짜? 놀랍네.';
    const out = validate({ reply });
    expect(out.message).toContain('진짜?');
  });

  test('긴 질문 여러 개 제거', () => {
    const reply = '음 그래. 근데 진짜 그 정책이 잘 먹힌다고 생각하는 이유가 뭐야?';
    const out = validate({ reply });
    expect(out.message).not.toContain('잘 먹힌다고 생각하는 이유가 뭐야?');
  });
});

describe('validate — stripQuestions 안전장치', () => {
  test('응답 전체가 긴 질문이면 원본 반환 (빈 message 방지)', () => {
    const reply = '이 뉴스에 대해서 너는 진짜 어떻게 생각하는지 궁금한데?';
    const out = validate({ reply });
    expect(out.message.length).toBeGreaterThan(0);
  });

  test('여러 줄 응답 — 각 줄에서 긴 질문만 제거', () => {
    const reply = '오늘 뉴스 봤어.\n근데 정말 이 결과가 맞는 건지 너도 의심스럽지 않아?\n흥미로워.';
    const out = validate({ reply });
    expect(out.message).toContain('오늘 뉴스 봤어');
    expect(out.message).toContain('흥미로워');
    expect(out.message).not.toContain('의심스럽지 않아?');
  });
});
