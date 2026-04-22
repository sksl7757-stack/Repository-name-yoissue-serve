const {
  buildAutoLog,
  mergeLog,
  parseCounts,
  FINAL_TITLE_PLACEHOLDER,
  FINAL_TITLE_MARKER,
} = require('../redlineLog');

describe('buildAutoLog', () => {
  test('빈 입력 → 섹션별 플레이스홀더, 유저 편집 영역 미포함', () => {
    const md = buildAutoLog({
      date: '2026-04-22',
      collectedCount: 0,
      blocked: [],
      passed: [],
    });
    expect(md).toContain('# 2026-04-22 레드라인 로그');
    expect(md).toContain('#레드라인 #2026-04');
    expect(md).toContain('- 수집: 0건');
    expect(md).toContain('- 차단: 0건');
    expect(md).toContain('- 통과: 0건');
    expect(md).toContain(`- 최종 선정: ${FINAL_TITLE_MARKER}`);
    expect(md).toContain('_차단된 뉴스 없음._');
    expect(md).toContain('_통과된 뉴스 없음._');
    // auto_log 에는 유저 편집 영역(판단·메모·조정 사항) 없음
    expect(md).not.toContain('판단: ');
    expect(md).not.toContain('조정 사항');
  });

  test('카테고리별 그룹화 + 매칭 키워드 + URL', () => {
    const md = buildAutoLog({
      date: '2026-04-22',
      collectedCount: 5,
      blocked: [
        { category: 'politicians',    title: '이재명 회의', matched: '이재명',    url: 'https://a.com/1' },
        { category: 'politicians',    title: '트럼프 관세', matched: '트럼프',    url: 'https://b.com/1' },
        { category: 'armed_conflict', title: '가자 전쟁',   matched: '가자 전쟁', url: 'https://c.com/1' },
      ],
      passed: [{ title: '반도체 수출', url: 'https://www.news.naver.com/x' }],
    });

    expect(md).toContain('## 🚫 차단 (3건)');
    expect(md).toContain('### B-1 정치인 (2건)');
    expect(md).toContain('### B-3 무력분쟁 (1건)');
    expect(md).toContain('- **이재명 회의**');
    expect(md).toContain('  - 매칭: `이재명`');
    expect(md).toContain('  - URL: https://a.com/1');
    expect(md).toContain('## ✅ 통과 (1건)');
    expect(md).toContain('  - 출처: news.naver.com');
  });

  test('카테고리 순서 A → B', () => {
    const md = buildAutoLog({
      date: '2026-04-22',
      collectedCount: 3,
      blocked: [
        { category: 'armed_conflict', title: '가자',   matched: '가자 전쟁', url: 'https://a/1' },
        { category: 'suicide',        title: '유서',   matched: '유서 발견', url: 'https://b/1' },
        { category: 'politicians',    title: '이재명', matched: '이재명',    url: 'https://c/1' },
      ],
      passed: [],
    });
    const a1 = md.indexOf('### A-1 자살');
    const b1 = md.indexOf('### B-1 정치인');
    const b3 = md.indexOf('### B-3 무력분쟁');
    expect(a1).toBeGreaterThan(-1);
    expect(b1).toBeGreaterThan(-1);
    expect(b3).toBeGreaterThan(-1);
    expect(a1).toBeLessThan(b1);
    expect(b1).toBeLessThan(b3);
  });

  test('url dedupe', () => {
    const md = buildAutoLog({
      date: '2026-04-22',
      collectedCount: 2,
      blocked: [
        { category: 'politicians', title: '이재명', matched: '이재명', url: 'https://dup/1' },
        { category: 'politicians', title: '이재명', matched: '이재명', url: 'https://dup/1' },
      ],
      passed: [
        { title: '반도체', url: 'https://p/1' },
        { title: '반도체', url: 'https://p/1' },
      ],
    });
    expect(md).toContain('- 차단: 1건');
    expect(md).toContain('- 통과: 1건');
  });

  test('url 파싱 실패 → 출처 (unknown)', () => {
    const md = buildAutoLog({
      date: '2026-04-22',
      collectedCount: 1,
      blocked: [],
      passed: [{ title: '뉴스', url: 'not-a-url' }],
    });
    expect(md).toContain('  - 출처: (unknown)');
  });
});

describe('mergeLog', () => {
  const sampleAuto = [
    '## 요약',
    '- 차단: 0건',
    `- 최종 선정: ${FINAL_TITLE_MARKER}`,
    '',
  ].join('\n');

  test('final_title 없음 → 플레이스홀더 치환', () => {
    const merged = mergeLog({ auto_log: sampleAuto, user_notes: '', final_title: null });
    expect(merged).toContain(`- 최종 선정: ${FINAL_TITLE_PLACEHOLDER}`);
    expect(merged).not.toContain(FINAL_TITLE_MARKER);
  });

  test('final_title 있음 → 그 값으로 치환', () => {
    const merged = mergeLog({ auto_log: sampleAuto, user_notes: '', final_title: '반도체 수출 증가' });
    expect(merged).toContain('- 최종 선정: 반도체 수출 증가');
    expect(merged).not.toContain(FINAL_TITLE_MARKER);
  });

  test('user_notes 있음 → 하단에 구분선과 함께 추가', () => {
    const merged = mergeLog({
      auto_log: sampleAuto,
      user_notes: '## 메모\n- 오늘 조정 없음\n',
      final_title: null,
    });
    expect(merged).toContain('## 메모');
    expect(merged).toContain('- 오늘 조정 없음');
    expect(merged.indexOf('## 메모')).toBeGreaterThan(merged.indexOf('## 요약'));
    expect(merged).toMatch(/---\s+## 메모/);
  });

  test('user_notes 공백만 → 구분선 없이 auto_log 만', () => {
    const merged = mergeLog({ auto_log: 'body', user_notes: '   ', final_title: null });
    expect(merged).toBe('body');
  });
});

describe('parseCounts', () => {
  test('buildAutoLog 출력에서 수집/차단/통과 정상 추출', () => {
    const md = buildAutoLog({
      date: '2026-04-22',
      collectedCount: 45,
      blocked: [
        { category: 'politicians',    title: 't1', matched: '이재명', url: 'https://a/1' },
        { category: 'armed_conflict', title: 't2', matched: '가자 전쟁', url: 'https://a/2' },
      ],
      passed: [{ title: 'p', url: 'https://p/1' }],
    });
    expect(parseCounts(md)).toEqual({ collectedCount: 45, blockedCount: 2, passedCount: 1 });
  });

  test('빈/null 입력 → 0', () => {
    expect(parseCounts('')).toEqual({ collectedCount: 0, blockedCount: 0, passedCount: 0 });
    expect(parseCounts(null)).toEqual({ collectedCount: 0, blockedCount: 0, passedCount: 0 });
  });

  test('포맷 어긋남 → 매치 실패한 필드는 0', () => {
    expect(parseCounts('- 수집: 10건\n딴 거\n- 통과: 3건')).toEqual({
      collectedCount: 10,
      blockedCount:   0,
      passedCount:    3,
    });
  });
});
