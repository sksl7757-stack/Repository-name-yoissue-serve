// buildSystemPrompt 출력 snapshot 잠금.
// 리팩터링 전후 비교로 회귀 방지.
//
// getTodayNews 는 네트워크 호출이라 mock — 픽스처 고정으로 snapshot 안정.

jest.mock('../supabase', () => ({
  getTodayNews: jest.fn().mockResolvedValue({
    title:   '기준금리 동결 결정',
    summary: ['금통위 회의', '시장 영향 관찰'],
    content: '한국은행 금통위는 이번 회의에서 기준금리를 3.50% 수준으로 동결하기로 결정했다. '
      + '물가 상승 압력과 경기 회복 속도를 모두 고려한 판단이다. '
      + '시장에서는 다음 회의에서 방향 전환 가능성을 주시하고 있다.',
  }),
}));

const { buildSystemPrompt } = require('../generator');

const NEWS_OPINION_MESSAGES = [
  { role: 'user', content: '이번 결정 어떻게 생각해?' },
];
const NEWS_CONVERSE_MESSAGES = [
  { role: 'user', content: '이 뉴스 봤어.' },
];

describe('buildSystemPrompt — MOURNING 모드', () => {
  test('하나 + 메모리 없음', async () => {
    const out = await buildSystemPrompt('하나', null, {
      isMourning: true,
      phase:      'INIT',
      messages:   NEWS_CONVERSE_MESSAGES,
    });
    expect(out).toMatchSnapshot();
  });

  test('준혁 + 메모리 있음', async () => {
    const out = await buildSystemPrompt('준혁', '유저는 경제 뉴스 관심', {
      isMourning: true,
      phase:      'INIT',
      messages:   NEWS_CONVERSE_MESSAGES,
    });
    expect(out).toMatchSnapshot();
  });
});

describe('buildSystemPrompt — SECONDARY 모드', () => {
  test('하나가 준혁(negative) 에 반박, 스스로 positive', async () => {
    const out = await buildSystemPrompt('하나', null, {
      phase:            'INIT',
      primaryCharName:  '준혁',
      primaryComment:   '이거 리스크 커 보이는데.',
      primaryEmotion:   'negative',
      characterEmotion: 'positive',
      messages:         NEWS_CONVERSE_MESSAGES,
    });
    expect(out).toMatchSnapshot();
  });

  test('준혁이 하나(positive) 에 반박, 스스로 negative', async () => {
    const out = await buildSystemPrompt('준혁', null, {
      phase:            'INIT',
      primaryCharName:  '하나',
      primaryComment:   '나는 기회라고 봐!',
      primaryEmotion:   'positive',
      characterEmotion: 'negative',
      messages:         NEWS_CONVERSE_MESSAGES,
    });
    expect(out).toMatchSnapshot();
  });
});

describe('buildSystemPrompt — OPINION 모드', () => {
  test('하나 + INIT + positive stance', async () => {
    const out = await buildSystemPrompt('하나', null, {
      phase:            'INIT',
      characterEmotion: 'positive',
      messages:         NEWS_OPINION_MESSAGES,
    });
    expect(out).toMatchSnapshot();
  });
});

describe('buildSystemPrompt — CONVERSE 모드', () => {
  test('준혁 + CHAT + negative stance', async () => {
    const out = await buildSystemPrompt('준혁', null, {
      phase:            'CHAT',
      characterEmotion: 'negative',
      messages:         NEWS_CONVERSE_MESSAGES,
    });
    expect(out).toMatchSnapshot();
  });

  test('하나 + isPerspectiveRequest + perspectiveStep=2', async () => {
    const out = await buildSystemPrompt('하나', null, {
      phase:                'CHAT',
      isPerspectiveRequest: true,
      perspectiveStep:      2,
      characterEmotion:     'positive',
      messages:             NEWS_CONVERSE_MESSAGES,
    });
    expect(out).toMatchSnapshot();
  });

  test('하나 + stance 없음 (neutral → 시점 고정 규칙 제외)', async () => {
    const out = await buildSystemPrompt('하나', null, {
      phase:    'CHAT',
      messages: NEWS_CONVERSE_MESSAGES,
    });
    expect(out).toMatchSnapshot();
  });
});

describe('buildSystemPrompt — 구조적 불변식 (리팩터링 가드)', () => {
  test('MOURNING 은 secondaryFormat/primaryDirection/hardRule 스킵', async () => {
    const out = await buildSystemPrompt('하나', null, {
      isMourning: true,
      phase:      'INIT',
      messages:   NEWS_CONVERSE_MESSAGES,
    });
    expect(out).not.toContain('【출력 형식 강제 — 최우선 규칙】');
    expect(out).not.toContain('【응답 원칙 — 최우선 규칙】');
    expect(out).not.toContain('【출력 규칙】');
  });

  test('SECONDARY 는 primaryComment 포함 + newsDetailBlock 제외', async () => {
    const out = await buildSystemPrompt('하나', null, {
      primaryCharName: '준혁',
      primaryComment:  '리스크 있어.',
      primaryEmotion:  'negative',
      phase:           'INIT',
      messages:        NEWS_CONVERSE_MESSAGES,
    });
    expect(out).toContain('"리스크 있어."');
    expect(out).not.toContain('<<<NEWS_START>>>');
  });

  test('CONVERSE 는 newsDetailBlock + primaryDirection 포함', async () => {
    const out = await buildSystemPrompt('하나', null, {
      phase:    'CHAT',
      messages: NEWS_CONVERSE_MESSAGES,
    });
    expect(out).toContain('<<<NEWS_START>>>');
    expect(out).toContain('【응답 원칙 — 최우선 규칙】');
  });

  test('stance emotion 시점 고정 규칙은 positive/negative 에만 주입', async () => {
    const withStance = await buildSystemPrompt('하나', null, {
      phase:            'CHAT',
      characterEmotion: 'positive',
      messages:         NEWS_CONVERSE_MESSAGES,
    });
    const withoutStance = await buildSystemPrompt('하나', null, {
      phase:            'CHAT',
      characterEmotion: null,
      messages:         NEWS_CONVERSE_MESSAGES,
    });
    expect(withStance).toContain('시점 고정');
    expect(withoutStance).not.toContain('시점 고정');
  });

  test('sessionStance 는 캐릭터 × emotion 조합으로 분기', async () => {
    const hanaPos = await buildSystemPrompt('하나', null, {
      phase: 'CHAT', characterEmotion: 'positive', messages: NEWS_CONVERSE_MESSAGES,
    });
    const junPos = await buildSystemPrompt('준혁', null, {
      phase: 'CHAT', characterEmotion: 'positive', messages: NEWS_CONVERSE_MESSAGES,
    });
    const hanaNeg = await buildSystemPrompt('하나', null, {
      phase: 'CHAT', characterEmotion: 'negative', messages: NEWS_CONVERSE_MESSAGES,
    });
    const junNeg = await buildSystemPrompt('준혁', null, {
      phase: 'CHAT', characterEmotion: 'negative', messages: NEWS_CONVERSE_MESSAGES,
    });
    expect(hanaPos).toContain('감성적 긍정');
    expect(junPos).toContain('냉철한 긍정');
    expect(hanaNeg).toContain('감성적 걱정');
    expect(junNeg).toContain('냉철한 우려');
  });
});
