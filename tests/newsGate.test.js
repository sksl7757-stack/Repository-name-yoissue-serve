const { shouldPersistNews } = require('../newsGate');

describe('shouldPersistNews', () => {
  const base = {
    url: 'https://example.com/a',
    content: 'x'.repeat(250),
    isFallback: false,
  };

  test('healthy → ok', () => {
    expect(shouldPersistNews(base)).toEqual({ ok: true, reason: null });
  });

  test('no_url — url null', () => {
    expect(shouldPersistNews({ ...base, url: null })).toEqual({ ok: false, reason: 'no_url' });
  });

  test('no_url — url 빈 문자열', () => {
    expect(shouldPersistNews({ ...base, url: '' })).toEqual({ ok: false, reason: 'no_url' });
  });

  test('no_url 우선 — url 없으면 다른 조건과 무관', () => {
    expect(shouldPersistNews({ url: null, content: null, isFallback: true })).toEqual({
      ok: false,
      reason: 'no_url',
    });
  });

  test('fallback — isFallback true 면 content 길이 무관 reject', () => {
    expect(shouldPersistNews({ ...base, isFallback: true, content: 'x'.repeat(500) })).toEqual({
      ok: false,
      reason: 'fallback',
    });
  });

  test('no_content — content null', () => {
    expect(shouldPersistNews({ ...base, content: null })).toEqual({
      ok: false,
      reason: 'no_content',
    });
  });

  test('too_short — content 199자', () => {
    expect(shouldPersistNews({ ...base, content: 'x'.repeat(199) })).toEqual({
      ok: false,
      reason: 'too_short',
    });
  });

  test('경계 — content 200자 → ok', () => {
    expect(shouldPersistNews({ ...base, content: 'x'.repeat(200) })).toEqual({
      ok: true,
      reason: null,
    });
  });

  test('content 빈 문자열 & !isFallback → too_short', () => {
    expect(shouldPersistNews({ ...base, content: '' })).toEqual({
      ok: false,
      reason: 'too_short',
    });
  });
});
