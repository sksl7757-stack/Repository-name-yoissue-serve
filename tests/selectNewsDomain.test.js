const { isAllowedDomain, ALLOWED_DOMAINS } = require('../select-news');

describe('isAllowedDomain (화이트리스트)', () => {
  test('정확 매칭 — 루트 도메인', () => {
    expect(isAllowedDomain('https://yna.co.kr/view/1')).toBe(true);
    expect(isAllowedDomain('https://www.yna.co.kr/view/1')).toBe(true);
    expect(isAllowedDomain('https://kbs.co.kr/news/1')).toBe(true);
  });

  test('서브도메인 매칭 — news.kbs.co.kr, imnews.imbc.com 등', () => {
    expect(isAllowedDomain('https://news.kbs.co.kr/news/view.do?ncd=1')).toBe(true);
    expect(isAllowedDomain('https://imnews.imbc.com/news/2026/1.html')).toBe(true);
    expect(isAllowedDomain('https://news.sbs.co.kr/news/endPage.do?news_id=1')).toBe(true);
  });

  test('화이트리스트 밖 매체 — 차단', () => {
    expect(isAllowedDomain('https://hankyung.com/article/1')).toBe(false);
    expect(isAllowedDomain('https://news.einfomax.co.kr/articles/1')).toBe(false);
    expect(isAllowedDomain('https://chosun.com/politics/1')).toBe(false);
    expect(isAllowedDomain('https://joongang.co.kr/article/1')).toBe(false);
  });

  test('스푸핑 방어 — 유사 호스트는 차단', () => {
    // 과거 .includes 방식이었으면 true 였을 케이스들
    expect(isAllowedDomain('https://malicious-kbs.co.kr/fake')).toBe(false);
    expect(isAllowedDomain('https://fakekbs.co.kr/fake')).toBe(false);
    expect(isAllowedDomain('https://sbs.co.kr.evil.com/x')).toBe(false);
    expect(isAllowedDomain('https://yna.co.kr.phishing.example/1')).toBe(false);
  });

  test('URL 파싱 실패 — 차단 (safe default)', () => {
    expect(isAllowedDomain('not-a-url')).toBe(false);
    expect(isAllowedDomain('')).toBe(false);
    expect(isAllowedDomain(null)).toBe(false);
  });

  test('화이트리스트 내용 — 10개 매체', () => {
    expect(ALLOWED_DOMAINS).toHaveLength(10);
    expect(ALLOWED_DOMAINS).toContain('yna.co.kr');
    expect(ALLOWED_DOMAINS).toContain('kbs.co.kr');
    expect(ALLOWED_DOMAINS).toContain('etnews.com');
    expect(ALLOWED_DOMAINS).toContain('zdnet.co.kr');
  });
});
