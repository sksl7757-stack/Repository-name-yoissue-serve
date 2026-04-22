// 뉴스 저장 전 최후 게이트 — daily_news write-path 보호.
// thin/orphan row 가 들어가면 프론트가 "이상한 옛 뉴스" 를 노출하므로
// 거부하고 markAllProcessed 만 호출하여 어제 row 유지한다. 절대 soft fallback 금지.

const MIN_CONTENT_LENGTH = 200;

function shouldPersistNews({ url, content, isFallback }) {
  if (!url) return { ok: false, reason: 'no_url' };
  if (isFallback) return { ok: false, reason: 'fallback' };
  if (content == null) return { ok: false, reason: 'no_content' };
  if (content.length < MIN_CONTENT_LENGTH) return { ok: false, reason: 'too_short' };
  return { ok: true, reason: null };
}

module.exports = { shouldPersistNews, MIN_CONTENT_LENGTH };
