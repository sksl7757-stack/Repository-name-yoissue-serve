-- 002_redline_logs.sql — 일일 redline 필터링 결과 저장 + 유저 메모.
-- 2026-04-22 작성.
--
-- 컬럼 분리 이유:
--   - auto_log   : Stage 1 cron 이 매일 overwrite (차단·통과 자동 집계).
--   - user_notes : 유저가 브라우저 뷰어에서 편집. cron 이 절대 건드리지 않음.
--   - final_title: Stage 2 (process-news) 가 pickBestNews 후 갱신.
--
-- 접근: 백엔드 service-role 키로만 CRUD. anon/authenticated 접근 불허이므로 RLS 미적용
-- (새 테이블은 기본 RLS off). 추후 공개 뷰어 확장 시 RLS + policy 추가.

create table if not exists redline_logs (
  date         date        primary key,
  auto_log     text        not null,
  user_notes   text        not null default '',
  final_title  text,
  updated_at   timestamptz not null default now()
);

create index if not exists idx_redline_logs_date_desc on redline_logs (date desc);
