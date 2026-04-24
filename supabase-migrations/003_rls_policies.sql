-- 003_rls_policies.sql — 유저 데이터 테이블 RLS + anon 차단 정책.
-- 2026-04-24 작성. Tier 1 로드맵 #8 이행.
--
-- 적용 전 읽을 것:
-- - Supabase Auth 없음. auth.uid() 는 항상 NULL 이라 "user_id = auth.uid()" 정책은
--   의미가 없다. 현재 MVP 에서 RLS 의 실제 효과는 "anon key 로 REST 직접 호출 차단"
--   하나다. 실제 유저별 격리는 백엔드가 service role + .eq('user_id', userId) 로
--   이미 처리하고 있음 (records.js, saveNews.js, persist.js).
-- - service_role 은 모든 RLS 를 bypass → 서버 코드는 영향 없음.
-- - 프론트(chatHome.ts)가 anon key 로 직접 조회하는 테이블은 daily_news 뿐.
--   daily_news 는 공용 데이터이므로 anon SELECT 만 허용, 쓰기는 차단.
-- - 나머지 유저 데이터 테이블은 anon 전 작업 차단. 앱에서 쓰려면 백엔드 경유 강제.
--
-- 적용 방법:
-- 1) Supabase 대시보드 → SQL Editor 에 이 파일 내용 붙여넣기
-- 2) 먼저 "모든 SELECT" 블록만 실행해 각 테이블 상태 확인
-- 3) enable + policy 블록 단계적으로 실행. 에러 나면 해당 테이블만 롤백 (DISABLE ROW LEVEL SECURITY).
-- 4) 적용 후 앱 정상 동작 확인 — 서버 경유 경로는 service_role 로 통과, 프론트 daily_news 직접 조회는 anon SELECT 로 통과.

-- ── 사전 확인: 현재 RLS 상태 조회 ──────────────────────────────────────────────
-- select schemaname, tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public'
--   and tablename in (
--     'users','conversations','messages','memory_chunks','memory_summaries',
--     'saved_news','records','push_tokens','daily_news'
--   );

-- ── 1) users ──────────────────────────────────────────────────────────────
alter table public.users enable row level security;
-- anon 에 대한 정책을 만들지 않음 = 기본 deny. service_role 은 RLS bypass.

-- ── 2) conversations ──────────────────────────────────────────────────────
alter table public.conversations enable row level security;

-- ── 3) messages ───────────────────────────────────────────────────────────
alter table public.messages enable row level security;

-- ── 4) memory_chunks ──────────────────────────────────────────────────────
alter table public.memory_chunks enable row level security;

-- ── 5) memory_summaries ───────────────────────────────────────────────────
alter table public.memory_summaries enable row level security;

-- ── 6) saved_news ─────────────────────────────────────────────────────────
-- 스키마가 마이그레이션에 없다 — 대시보드에서 만들어진 테이블. 존재 가정.
alter table public.saved_news enable row level security;

-- ── 7) records ────────────────────────────────────────────────────────────
alter table public.records enable row level security;

-- ── 8) push_tokens ────────────────────────────────────────────────────────
-- user_id 컬럼은 nullable 로 추가됨. 레거시 행 user_id NULL 존재 가능.
-- Auth 없는 현 구조에선 RLS 관점에서 anon 전 차단이 최선.
alter table public.push_tokens enable row level security;

-- ── 9) daily_news ─────────────────────────────────────────────────────────
-- 공용 뉴스 데이터. 프론트 chatHome.ts:96 이 anon key 로 직접 조회 중.
-- anon 에 SELECT 만 허용. INSERT/UPDATE/DELETE 는 백엔드 service_role 전용.
alter table public.daily_news enable row level security;

drop policy if exists "daily_news anon select" on public.daily_news;
create policy "daily_news anon select"
  on public.daily_news
  for select
  to anon
  using (true);

-- ── 롤백 (문제 시) ────────────────────────────────────────────────────────
-- alter table public.users           disable row level security;
-- alter table public.conversations   disable row level security;
-- alter table public.messages        disable row level security;
-- alter table public.memory_chunks   disable row level security;
-- alter table public.memory_summaries disable row level security;
-- alter table public.saved_news      disable row level security;
-- alter table public.records         disable row level security;
-- alter table public.push_tokens     disable row level security;
-- alter table public.daily_news      disable row level security;
-- drop policy if exists "daily_news anon select" on public.daily_news;

-- ── Auth 도입 후 교체 (참고) ──────────────────────────────────────────────
-- Supabase Auth 전환 시 users.id 를 uuid 로 마이그레이션 + device_id 매칭으로 병합.
-- 그 뒤 각 유저 테이블에 아래 패턴 정책 추가:
--
-- create policy "<table> user can read own"
--   on public.<table>
--   for select
--   to authenticated
--   using (user_id = auth.uid()::text);
--
-- create policy "<table> user can insert own"
--   on public.<table>
--   for insert
--   to authenticated
--   with check (user_id = auth.uid()::text);
--
-- create policy "<table> user can update own"
--   on public.<table>
--   for update
--   to authenticated
--   using (user_id = auth.uid()::text)
--   with check (user_id = auth.uid()::text);
--
-- create policy "<table> user can delete own"
--   on public.<table>
--   for delete
--   to authenticated
--   using (user_id = auth.uid()::text);
--
-- messages 는 user_id 컬럼이 없고 conversation_id 만 있으므로 join 필요:
--   using (exists (select 1 from conversations c
--                  where c.id = messages.conversation_id
--                    and c.user_id = auth.uid()::text))
