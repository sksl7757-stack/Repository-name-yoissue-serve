const { isAllowedDomain, ALLOWED_DOMAINS } = require('../select-news');

describe('isAllowedDomain (화이트리스트)', () => {
  test('정확 매칭 — 루트 도메인', () => {
    expect(isAllowedDomain('https://yna.co.kr/view/1')).toBe(true);
    expect(isAllowedDomain('https://www.yna.co.kr/view/1')).toBe(true);
    expect(isAllowedDomain('https://ytn.co.kr/news/1')).toBe(true);
    expect(isAllowedDomain('https://korea.kr/briefing/policyNewsView.do?newsId=1')).toBe(true);
    expect(isAllowedDomain('https://etnews.com/article/1')).toBe(true);
  });

  test('서브도메인 매칭 — news.yna.co.kr, science.ytn.co.kr 등', () => {
    expect(isAllowedDomain('https://news.ytn.co.kr/news/view.do?ncd=1')).toBe(true);
    expect(isAllowedDomain('https://science.ytn.co.kr/program/1')).toBe(true);
    expect(isAllowedDomain('https://www.sciencetimes.co.kr/news/1')).toBe(true);
    expect(isAllowedDomain('https://www.zdnet.co.kr/view/?no=1')).toBe(true);
  });

  test('화이트리스트 밖 매체 — 차단', () => {
    expect(isAllowedDomain('https://hankyung.com/article/1')).toBe(false);
    expect(isAllowedDomain('https://news.einfomax.co.kr/articles/1')).toBe(false);
    expect(isAllowedDomain('https://chosun.com/politics/1')).toBe(false);
    expect(isAllowedDomain('https://joongang.co.kr/article/1')).toBe(false);
  });

  test('AI 저작권 소송 당사자 — 차단 (KBS, MBC, SBS)', () => {
    expect(isAllowedDomain('https://kbs.co.kr/news/1')).toBe(false);
    expect(isAllowedDomain('https://news.kbs.co.kr/news/view.do?ncd=1')).toBe(false);
    expect(isAllowedDomain('https://mbc.co.kr/news/1')).toBe(false);
    expect(isAllowedDomain('https://imnews.imbc.com/news/2026/1.html')).toBe(false);
    expect(isAllowedDomain('https://news.sbs.co.kr/news/endPage.do?news_id=1')).toBe(false);
  });

  test('스푸핑 방어 — 유사 호스트는 차단', () => {
    expect(isAllowedDomain('https://malicious-yna.co.kr/fake')).toBe(false);
    expect(isAllowedDomain('https://fakeyna.co.kr/fake')).toBe(false);
    expect(isAllowedDomain('https://ytn.co.kr.evil.com/x')).toBe(false);
    expect(isAllowedDomain('https://korea.kr.phishing.example/1')).toBe(false);
  });

  test('URL 파싱 실패 — 차단 (safe default)', () => {
    expect(isAllowedDomain('not-a-url')).toBe(false);
    expect(isAllowedDomain('')).toBe(false);
    expect(isAllowedDomain(null)).toBe(false);
  });

  test('화이트리스트 내용 — 9개 매체 (공공저작물 3 + 통신사 3 + 뉴스 전문 1 + IT 전문 2)', () => {
    expect(ALLOWED_DOMAINS).toHaveLength(9);
    // 공공저작물
    expect(ALLOWED_DOMAINS).toContain('korea.kr');
    expect(ALLOWED_DOMAINS).toContain('sciencetimes.co.kr');
    expect(ALLOWED_DOMAINS).toContain('science.ytn.co.kr');
    // 통신사
    expect(ALLOWED_DOMAINS).toContain('yna.co.kr');
    expect(ALLOWED_DOMAINS).toContain('news1.kr');
    expect(ALLOWED_DOMAINS).toContain('newsis.com');
    // 뉴스 전문
    expect(ALLOWED_DOMAINS).toContain('ytn.co.kr');
    // IT 전문
    expect(ALLOWED_DOMAINS).toContain('etnews.com');
    expect(ALLOWED_DOMAINS).toContain('zdnet.co.kr');
    // 제외 확인
    expect(ALLOWED_DOMAINS).not.toContain('kbs.co.kr');
    expect(ALLOWED_DOMAINS).not.toContain('mbc.co.kr');
    expect(ALLOWED_DOMAINS).not.toContain('sbs.co.kr');
  });
});
