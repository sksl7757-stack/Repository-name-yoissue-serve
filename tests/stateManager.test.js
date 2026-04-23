const { getState, updateState, PHASE } = require('../stateManager');

describe('getState', () => {
  test('빈 메시지 → INIT', () => {
    const state = getState([]);
    expect(state.phase).toBe(PHASE.INIT);
    expect(state.questionAsked).toBe(false);
  });

  test('assistant 없음 → INIT', () => {
    const state = getState([{ role: 'user', content: '안녕?' }]);
    expect(state.phase).toBe(PHASE.INIT);
    expect(state.questionAsked).toBe(false);
  });

  test('assistant 응답이 "?" 로 끝나지 않음 → INIT', () => {
    const state = getState([
      { role: 'user', content: '뉴스' },
      { role: 'assistant', content: '이 뉴스 좀 복잡해.' },
    ]);
    expect(state.phase).toBe(PHASE.INIT);
  });

  test('assistant 응답이 "?" 로 끝남 → CHAT', () => {
    const state = getState([
      { role: 'user', content: '뉴스' },
      { role: 'assistant', content: '너는 어떻게 생각해?' },
    ]);
    expect(state.phase).toBe(PHASE.CHAT);
    expect(state.questionAsked).toBe(true);
  });

  test('"?" 뒤에 공백/개행 있어도 CHAT 판정', () => {
    const state = getState([
      { role: 'assistant', content: '어떻게 생각해?  \n' },
    ]);
    expect(state.phase).toBe(PHASE.CHAT);
  });

  test('"?" 가 중간에 있고 끝은 "."  → INIT (URL·본문 내 ? 오판 방지)', () => {
    const state = getState([
      { role: 'assistant', content: 'https://example.com/x?q=1 를 봤어.' },
    ]);
    expect(state.phase).toBe(PHASE.INIT);
  });

  test('user 메시지의 "?" 는 무시 — assistant 만 phase 결정', () => {
    const state = getState([
      { role: 'user', content: '뭔데?' },
      { role: 'assistant', content: '이거 흥미롭네.' },
    ]);
    expect(state.phase).toBe(PHASE.INIT);
  });
});

describe('updateState', () => {
  test('questionAsked=true → CHAT', () => {
    const next = updateState({}, { questionAsked: true });
    expect(next.phase).toBe(PHASE.CHAT);
    expect(next.questionAsked).toBe(true);
  });

  test('questionAsked=false → INIT', () => {
    const next = updateState({}, { questionAsked: false });
    expect(next.phase).toBe(PHASE.INIT);
  });
});
