const { isRedlineTitle } = require('../redline');

describe('isRedlineTitle', () => {
  describe('통과', () => {
    test('일반 경제 헤드라인 → 통과', () => {
      expect(isRedlineTitle('반도체 수출 3개월 연속 증가')).toEqual({ blocked: false, reason: null });
    });
    test('일반 IT 헤드라인 → 통과', () => {
      expect(isRedlineTitle('삼성, 신형 AI 칩 공개')).toEqual({ blocked: false, reason: null });
    });
  });

  // ─── A (윤리·법적) ────────────────────────────────────────────────────────
  describe('A-1 suicide', () => {
    test('"극단적 선택" 포함 → 블록', () => {
      expect(isRedlineTitle('유명 배우, 극단적 선택 충격')).toEqual({
        blocked: true, reason: 'redline_suicide',
      });
    });
    test('"유서 깊은 사찰" → 통과 (유서 단독 매칭 안 됨)', () => {
      expect(isRedlineTitle('유서 깊은 사찰 방문객 급증')).toEqual({ blocked: false, reason: null });
    });
    test('"유서 발견" → 블록', () => {
      expect(isRedlineTitle('야산에서 유서 발견')).toEqual({
        blocked: true, reason: 'redline_suicide',
      });
    });
  });

  describe('A-2 minor_sex (pair)', () => {
    test('미성년 + 성폭행 → 블록', () => {
      expect(isRedlineTitle('미성년자 성폭행 혐의 구속')).toEqual({
        blocked: true, reason: 'redline_minor_sex',
      });
    });
    test('아동 단독 → 통과', () => {
      expect(isRedlineTitle('아동 교육비 지원 확대')).toEqual({ blocked: false, reason: null });
    });
    test('성범죄 단독 → 통과 (B-6/다른 카테고리 영향 없는 케이스)', () => {
      expect(isRedlineTitle('성범죄 예방 캠페인 시행')).toEqual({ blocked: false, reason: null });
    });
  });

  describe('A-3 brutal_crime', () => {
    test('"흉기 난동" → 블록', () => {
      expect(isRedlineTitle('지하철역 흉기 난동 체포')).toEqual({
        blocked: true, reason: 'redline_brutal_crime',
      });
    });
  });

  describe('A-4 minor_sexual', () => {
    test('"딥페이크 성범죄" → 블록', () => {
      expect(isRedlineTitle('딥페이크 성범죄 수사 확대')).toEqual({
        blocked: true, reason: 'redline_minor_sexual',
      });
    });
  });

  // ─── B (편향 방어) ────────────────────────────────────────────────────────
  describe('B-1 politicians', () => {
    test('이재명 포함 → 블록', () => {
      expect(isRedlineTitle('이재명 대통령, 경제 회의 주재')).toEqual({
        blocked: true, reason: 'redline_politicians',
      });
    });
    test('트럼프 포함 → 블록 (해외 정치인)', () => {
      expect(isRedlineTitle('트럼프 관세 정책 발표')).toEqual({
        blocked: true, reason: 'redline_politicians',
      });
    });
    test('"조국수호단 집회" → 통과 (복합어, 조사 경계 미일치)', () => {
      expect(isRedlineTitle('조국수호단 집회 열려')).toEqual({ blocked: false, reason: null });
    });
    test('"조국 전 장관" → 블록 (공백 경계)', () => {
      expect(isRedlineTitle('조국 전 장관 재판 출석')).toEqual({
        blocked: true, reason: 'redline_politicians',
      });
    });
  });

  describe('B-2 election', () => {
    test('"대선" → 블록', () => {
      expect(isRedlineTitle('차기 대선 일정 확정')).toEqual({
        blocked: true, reason: 'redline_election',
      });
    });
    test('"공약" + "후보" 조합 → 블록', () => {
      expect(isRedlineTitle('A후보 주요 공약 공개')).toEqual({
        blocked: true, reason: 'redline_election',
      });
    });
    test('"공약" 단독 → 통과', () => {
      expect(isRedlineTitle('기업 ESG 공약 이행률')).toEqual({ blocked: false, reason: null });
    });
  });

  describe('B-3 armed_conflict', () => {
    test('"가자 전쟁" → 블록', () => {
      expect(isRedlineTitle('가자 전쟁 사망자 증가')).toEqual({
        blocked: true, reason: 'redline_armed_conflict',
      });
    });
  });

  describe('B-4 nk_provoke (pair)', () => {
    test('북한 + ICBM → 블록 (B-3 키워드와 겹치지 않는 조합)', () => {
      expect(isRedlineTitle('북한, 신형 ICBM 시험 성공 주장')).toEqual({
        blocked: true, reason: 'redline_nk_provoke',
      });
    });
    test('북한 + 핵실험 → 블록', () => {
      expect(isRedlineTitle('북한, 핵실험 임박 정황')).toEqual({
        blocked: true, reason: 'redline_nk_provoke',
      });
    });
    test('북한 단독(관광 등) → 통과', () => {
      expect(isRedlineTitle('북한 관광객 통계 발표')).toEqual({ blocked: false, reason: null });
    });
  });

  describe('B-5 historical', () => {
    test('"독도" → 블록', () => {
      expect(isRedlineTitle('독도 영유권 논쟁 재점화')).toEqual({
        blocked: true, reason: 'redline_historical',
      });
    });
  });

  describe('B-6 trial_investigation + whitelist', () => {
    test('"검찰 수사" → 블록', () => {
      expect(isRedlineTitle('A기업 대상 검찰 수사 개시')).toEqual({
        blocked: true, reason: 'redline_trial_investigation',
      });
    });
    test('"법 개정" 포함 → whitelist 통과', () => {
      expect(isRedlineTitle('불법 수사 방지 법 개정 추진')).toEqual({ blocked: false, reason: null });
    });
    test('"제도 개선" 포함 → whitelist 통과', () => {
      expect(isRedlineTitle('수사권 관련 제도 개선 토론회')).toEqual({ blocked: false, reason: null });
    });
  });

  describe('B-7 faction_clash', () => {
    test('"여야 충돌" → 블록', () => {
      expect(isRedlineTitle('예산안 여야 충돌 격화')).toEqual({
        blocked: true, reason: 'redline_faction_clash',
      });
    });
    test('"보수" + "대립" → 블록 (pair)', () => {
      expect(isRedlineTitle('보수-진보 대립 장기화')).toEqual({
        blocked: true, reason: 'redline_faction_clash',
      });
    });
    test('"보수적 투자 전략" → 통과 (pair 미성립)', () => {
      expect(isRedlineTitle('보수적 투자 전략 인기')).toEqual({ blocked: false, reason: null });
    });
  });

  describe('B-8 religion_eval', () => {
    test('"신천지" → 블록', () => {
      expect(isRedlineTitle('신천지 집단감염 논란')).toEqual({
        blocked: true, reason: 'redline_religion_eval',
      });
    });
  });

  describe('B-9 sanctions', () => {
    test('"대러 제재" → 블록', () => {
      expect(isRedlineTitle('EU, 대러 제재 강화')).toEqual({
        blocked: true, reason: 'redline_sanctions',
      });
    });
    test('"반도체 수출통제" → 통과 (수출통제 + 정치인 조합 미성립)', () => {
      expect(isRedlineTitle('반도체 수출통제 가이드라인 공개')).toEqual({ blocked: false, reason: null });
    });
    test('"트럼프 대러 수출통제" → 블록, reason 은 politicians (B-1 우선)', () => {
      expect(isRedlineTitle('트럼프, 대러 수출통제 확대')).toEqual({
        blocked: true, reason: 'redline_politicians',
      });
    });
  });
});
