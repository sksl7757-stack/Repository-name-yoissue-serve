// buildSystemPrompt / buildOpeningPairPrompt 출력 snapshot 잠금.
// 리팩터링 전후 비교로 회귀 방지.
//
// getTodayNews 는 네트워크 호출이라 mock — 픽스처 고정으로 snapshot 안정.

jest.mock('../supabase', () => ({
  getTodayNews: jest.fn().mockResolvedValue({
    title:    '기준금리 동결 결정',
    category: '경제',
    summary:  ['금통위 회의', '시장 영향 관찰'],
    content:  '한국은행 금통위는 이번 회의에서 기준금리를 3.50% 수준으로 동결하기로 결정했다. '
      + '물가 상승 압력과 경기 회복 속도를 모두 고려한 판단이다. '
      + '시장에서는 다음 회의에서 방향 전환 가능성을 주시하고 있다.',
  }),
}));

const { buildSystemPrompt, buildOpeningPairPrompt } = require('../generator');

const NEWS_OPINION_MESSAGES = [
  { role: 'user', content: '이번 결정 어떻게 생각해?' },
];
const NEWS_CONVERSE_MESSAGES = [
  { role: 'user', content: '이 뉴스 봤어.' },
];

const SAMPLE_STANCE = {
  axis: '단기 생활 체감 vs 장기 구조 변화',
  hana_side: '단기 생활 체감',
  junhyuk_side: '장기 구조 변화',
};

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

describe('buildSystemPrompt — CONVERSE / OPINION + stance 주입', () => {
  test('하나 + CHAT + stance 있음', async () => {
    const out = await buildSystemPrompt('하나', null, {
      phase:    'CHAT',
      messages: NEWS_CONVERSE_MESSAGES,
      stance:   SAMPLE_STANCE,
    });
    expect(out).toMatchSnapshot();
  });

  test('준혁 + INIT + stance 있음', async () => {
    const out = await buildSystemPrompt('준혁', null, {
      phase:    'INIT',
      messages: NEWS_CONVERSE_MESSAGES,
      stance:   SAMPLE_STANCE,
    });
    expect(out).toMatchSnapshot();
  });

  test('하나 + OPINION 모드 (유저가 의견 요청)', async () => {
    const out = await buildSystemPrompt('하나', null, {
      phase:    'INIT',
      messages: NEWS_OPINION_MESSAGES,
      stance:   SAMPLE_STANCE,
    });
    expect(out).toMatchSnapshot();
  });

  test('하나 + stance 없음 (fallback, 규칙 블록 스킵)', async () => {
    const out = await buildSystemPrompt('하나', null, {
      phase:    'CHAT',
      messages: NEWS_CONVERSE_MESSAGES,
    });
    expect(out).toMatchSnapshot();
  });

  test('하나 + isDeepen (listen 버튼)', async () => {
    const out = await buildSystemPrompt('하나', null, {
      phase:    'CHAT',
      messages: NEWS_CONVERSE_MESSAGES,
      stance:   SAMPLE_STANCE,
      isDeepen: true,
    });
    expect(out).toMatchSnapshot();
  });
});

describe('buildOpeningPairPrompt — 오프닝 페어 (두 캐릭터 동시)', () => {
  test('stance 주입 + 기본 뉴스', async () => {
    const out = await buildOpeningPairPrompt({ memory: null, stance: SAMPLE_STANCE });
    expect(out).toMatchSnapshot();
  });

  test('stance + 메모리 있음', async () => {
    const out = await buildOpeningPairPrompt({
      memory: '유저는 경제 뉴스 관심',
      stance: SAMPLE_STANCE,
    });
    expect(out).toMatchSnapshot();
  });
});

describe('buildSystemPrompt — 구조적 불변식 (리팩터링 가드)', () => {
  test('MOURNING 은 primaryDirection/hardRule/stance 스킵', async () => {
    const out = await buildSystemPrompt('하나', null, {
      isMourning: true,
      phase:      'INIT',
      messages:   NEWS_CONVERSE_MESSAGES,
      stance:     SAMPLE_STANCE,  // 추모 땐 stance 있어도 무시
    });
    expect(out).not.toContain('【응답 원칙 — 최우선 규칙】');
    expect(out).not.toContain('【출력 규칙】');
    expect(out).not.toContain('대립 구도');
    expect(out).not.toContain(SAMPLE_STANCE.axis);
  });

  test('CONVERSE 는 newsDetailBlock + primaryDirection 포함', async () => {
    const out = await buildSystemPrompt('하나', null, {
      phase:    'CHAT',
      messages: NEWS_CONVERSE_MESSAGES,
      stance:   SAMPLE_STANCE,
    });
    expect(out).toContain('<<<NEWS_START>>>');
    expect(out).toContain('【응답 원칙 — 최우선 규칙】');
  });

  test('stance 주입 블록은 stance 있을 때만', async () => {
    const withStance = await buildSystemPrompt('하나', null, {
      phase:    'CHAT',
      messages: NEWS_CONVERSE_MESSAGES,
      stance:   SAMPLE_STANCE,
    });
    const withoutStance = await buildSystemPrompt('하나', null, {
      phase:    'CHAT',
      messages: NEWS_CONVERSE_MESSAGES,
    });
    expect(withStance).toContain('대립 구도');
    expect(withStance).toContain(SAMPLE_STANCE.axis);
    expect(withoutStance).not.toContain('대립 구도');
  });

  test('isDeepen 은 심화 블록 주입, 추모에선 스킵', async () => {
    const withDeepen = await buildSystemPrompt('하나', null, {
      phase:    'CHAT',
      messages: NEWS_CONVERSE_MESSAGES,
      stance:   SAMPLE_STANCE,
      isDeepen: true,
    });
    const mourningDeepen = await buildSystemPrompt('하나', null, {
      phase:      'INIT',
      messages:   NEWS_CONVERSE_MESSAGES,
      isMourning: true,
      isDeepen:   true,
    });
    expect(withDeepen).toContain('심화 발언');
    expect(mourningDeepen).not.toContain('심화 발언');
  });

  test('정치 평가 금지 규칙은 MOURNING 제외 전 모드에 주입', async () => {
    const converse = await buildSystemPrompt('하나', null, {
      phase: 'CHAT', stance: SAMPLE_STANCE, messages: NEWS_CONVERSE_MESSAGES,
    });
    const mourning = await buildSystemPrompt('하나', null, {
      isMourning: true, phase: 'INIT', messages: NEWS_CONVERSE_MESSAGES,
    });
    expect(converse).toContain('정치 평가 금지');
    expect(mourning).not.toContain('정치 평가 금지');
  });

  test('카테고리 프레임은 news.category 에 따라 분기 (MOURNING 제외)', async () => {
    // 픽스처 category='경제' → '내 지갑·소비·일자리' 프레임
    const converse = await buildSystemPrompt('하나', null, {
      phase: 'CHAT', stance: SAMPLE_STANCE, messages: NEWS_CONVERSE_MESSAGES,
    });
    expect(converse).toContain('카테고리 프레임');
    expect(converse).toContain('"경제"');
    expect(converse).toContain('내 지갑');
  });

  test('newsDetailBlock 에 분류 라인 주입', async () => {
    const out = await buildSystemPrompt('하나', null, {
      phase: 'CHAT', messages: NEWS_CONVERSE_MESSAGES,
    });
    expect(out).toContain('분류: 경제');
  });

  test('뉴스 요약·설명 금지 규칙 주입 (MOURNING 제외)', async () => {
    const converse = await buildSystemPrompt('하나', null, {
      phase: 'CHAT', stance: SAMPLE_STANCE, messages: NEWS_CONVERSE_MESSAGES,
    });
    const mourning = await buildSystemPrompt('하나', null, {
      isMourning: true, phase: 'INIT', messages: NEWS_CONVERSE_MESSAGES,
    });
    expect(converse).toContain('뉴스 요약·설명 금지');
    expect(mourning).not.toContain('뉴스 요약·설명 금지');
  });
});

describe('buildOpeningPairPrompt — 구조적 불변식', () => {
  test('두 캐릭터 페르소나 모두 포함 + stance 주입 + JSON 형식 지시', async () => {
    const out = await buildOpeningPairPrompt({ memory: null, stance: SAMPLE_STANCE });
    expect(out).toContain('하나 페르소나');
    expect(out).toContain('준혁 페르소나');
    expect(out).toContain(SAMPLE_STANCE.axis);
    expect(out).toContain(SAMPLE_STANCE.hana_side);
    expect(out).toContain(SAMPLE_STANCE.junhyuk_side);
    expect(out).toContain('"hana"');
    expect(out).toContain('"junhyuk"');
    expect(out).toContain('대립 구도 설정 원칙');
  });

  test('newsDetailBlock + 카테고리 프레임 포함', async () => {
    const out = await buildOpeningPairPrompt({ memory: null, stance: SAMPLE_STANCE });
    expect(out).toContain('<<<NEWS_START>>>');
    expect(out).toContain('분류: 경제');
    expect(out).toContain('카테고리 프레임');
  });
});
