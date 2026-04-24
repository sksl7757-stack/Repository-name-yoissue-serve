-- 004_news_recall.sql — daily_news 오보 recall (soft delete) 컬럼 추가.
-- 2026-04-24 작성. Tier 2 #12 이행.
--
-- 배경: 잘못된 뉴스가 사용자에게 노출됐을 때 관리자가 즉시 숨길 수 있는 경로가 필요.
-- 하드 삭제 대신 soft delete — 감사/롤백/분석을 위해 row 자체는 유지.
--
-- daily_news 는 `date` 컬럼(YYYY-MM-DD) 을 사실상의 식별자로 사용 중 (모든 쿼리가
-- `.eq('date', ...)` 패턴). 별도 news_id 컬럼 없음 — admin API 도 date 를 키로 받는다.
--
-- 적용 방법: Supabase 대시보드 SQL Editor 에 전체 붙여넣고 Run. ALTER 는 idempotent
-- (if not exists) 라 재실행 안전. 적용 후 앱/서버 재배포 필요 없음 (기본값 false 로 즉시 동작).

-- ── 컬럼 추가 ─────────────────────────────────────────────────────────────
alter table public.daily_news
  add column if not exists is_deleted boolean not null default false,
  add column if not exists deleted_at timestamptz;

-- 기존 행 모두 is_deleted=false 로 채워짐 (default 덕분). 명시 필요 없음.

-- ── 조회 최적화 인덱스 ────────────────────────────────────────────────────
-- 모든 뉴스 조회에 is_deleted=false 필터가 들어감. date 컬럼 기반 정렬과 결합.
create index if not exists idx_daily_news_active
  on public.daily_news (date desc)
  where is_deleted = false;

-- ── 롤백 ──────────────────────────────────────────────────────────────────
-- drop index if exists public.idx_daily_news_active;
-- alter table public.daily_news
--   drop column if exists is_deleted,
--   drop column if exists deleted_at;
