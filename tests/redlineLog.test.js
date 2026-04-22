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

  test('final_title 없음 → 플레이스홀더 치환, 스포트라이트 섹션 없음', () => {
    const merged = mergeLog({ auto_log: sampleAuto, user_notes: '', final_title: null });
    expect(merged).toContain(`- 최종 선정: ${FINAL_TITLE_PLACEHOLDER}`);
    expect(merged).not.toContain(FINAL_TITLE_MARKER);
    expect(merged).not.toContain('## 📰 오늘 최종 선정');
  });

  test('final_title 있음 (메타 없음) → 스포트라이트에 링크 없이 제목만', () => {
    const merged = mergeLog({ auto_log: sampleAuto, user_notes: '', final_title: '반도체 수출 증가' });
    expect(merged).toContain('## 📰 오늘 최종 선정');
    expect(merged).toContain('### 반도체 수출 증가');
    expect(merged).not.toContain('### [반도체 수출 증가]');
    expect(merged).not.toContain('원문 보기');
    expect(merged.indexOf('## 📰 오늘 최종 선정')).toBeLessThan(merged.indexOf('## 요약'));
  });

  test('final_meta 있음 → 제목 하이퍼링크 + 출처/카테고리/원문 링크', () => {
    const merged = mergeLog({
      auto_log: sampleAuto,
      user_notes: '',
      final_title: '반도체 수출 증가',
      final_meta: {
        url: 'https://news.einfomax.co.kr/articles/12345',
        category: '경제',
      },
    });
    expect(merged).toContain('### [반도체 수출 증가](https://news.einfomax.co.kr/articles/12345)');
    expect(merged).toContain('- **출처**: news.einfomax.co.kr');
    expect(merged).toContain('- **카테고리**: 경제');
    expect(merged).toContain('[🔗 원문 보기 →](https://news.einfomax.co.kr/articles/12345)');
  });

  test('final_title 이 통과 목록의 제목과 일치 → ⭐ + URL 링크', () => {
    const autoWithPassed = [
      '## 요약',
      `- 최종 선정: ${FINAL_TITLE_MARKER}`,
      '',
      '## ✅ 통과 (2건)',
      '',
      '- **반도체 수출 증가**',
      '  - 출처: example.com',
      '- **환율 안정세**',
      '  - 출처: other.com',
      '',
    ].join('\n');
    const merged = mergeLog({
      auto_log: autoWithPassed,
      user_notes: '',
      final_title: '반도체 수출 증가',
      final_meta: { url: 'https://example.com/1', category: '경제' },
    });
    expect(merged).toContain('- ⭐ **[반도체 수출 증가](https://example.com/1)** _← 최종 선정_');
    expect(merged).toContain('- **환율 안정세**'); // 다른 라인은 그대로
  });

  test('final_meta 없이 final_title 만 → 통과 목록에 ⭐ (링크 없이)', () => {
    const autoWithPassed = [
      '## 요약',
      `- 최종 선정: ${FINAL_TITLE_MARKER}`,
      '',
      '- **반도체 수출 증가**',
      '',
    ].join('\n');
    const merged = mergeLog({ auto_log: autoWithPassed, user_notes: '', final_title: '반도체 수출 증가' });
    expect(merged).toContain('- ⭐ **반도체 수출 증가** _← 최종 선정_');
  });

  test('게이트 거부 플레이스홀더(_(...)_)는 스포트라이트 없음', () => {
    const merged = mergeLog({
      auto_log: sampleAuto,
      user_notes: '',
      final_title: '_(게이트 거부: thin_content)_',
    });
    expect(merged).toContain('_(게이트 거부: thin_content)_');
    expect(merged).not.toContain('## 📰 오늘 최종 선정');
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
