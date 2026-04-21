-- 001_memory.sql — 임베딩 기반 캐릭터 메모리 MVP 스키마.
-- 2026-04-21 작성. 현 단계에서 쓰이는 건 users/conversations/messages (원문 영구 저장)
-- 뿐이지만, memory_chunks/memory_summaries 스키마를 지금 확정해두어 2단계(임베딩 훅)
-- 에서 추가 마이그레이션이 필요 없게 했다.
--
-- id 타입 주의: users.id 는 text (프론트 getOrCreateUserId 가 `user_${ts}_${rand}` 를 반환).
-- Supabase Auth 로 전환 시 device_id 컬럼을 통해 기존 레코드를 uuid user 로 병합할 것.

create extension if not exists pgcrypto;
create extension if not exists vector;

-- ── users ────────────────────────────────────────────────────────────────────
-- 현재는 AsyncStorage 에서 생성한 문자열 id. 유료/로그인 도입 시 device_id 매칭으로 병합.

create table if not exists users (
  id         text        primary key,
  device_id  text,
  tier       text        not null default 'free',
  created_at timestamptz not null default now()
);

create index if not exists idx_users_device_id on users (device_id);

-- ── conversations ────────────────────────────────────────────────────────────
-- MVP 경계: (user_id, char_key, date_kst) 당 하나. 앱의 일일 뉴스 주기에 맞춤.
-- 클라이언트 세션 추적 불필요, 서버가 upsert.

create table if not exists conversations (
  id         uuid        primary key default gen_random_uuid(),
  user_id    text        not null references users(id) on delete cascade,
  char_key   text        not null,
  date_kst   date        not null,
  created_at timestamptz not null default now(),
  unique (user_id, char_key, date_kst)
);

create index if not exists idx_conversations_user on conversations (user_id, char_key);

-- ── messages ────────────────────────────────────────────────────────────────
-- 원문 영구 저장. 강제종료 유실 해결의 핵심. pgvector 없음 — 임베딩은 memory_chunks 에서만.

create table if not exists messages (
  id              bigserial   primary key,
  conversation_id uuid        not null references conversations(id) on delete cascade,
  role            text        not null check (role in ('user','assistant','system')),
  char_key        text,
  content         text        not null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_messages_conversation on messages (conversation_id, id);

-- ── memory_chunks ───────────────────────────────────────────────────────────
-- 2단계(세션 종료 임베딩 훅)에서 채워짐. 스키마는 지금 확정.
-- source_message_ids: 이 chunk 가 어떤 messages 로부터 왔는지 역참조.
-- salience: 중요도 (기본 1). recall 시 decay/boost 로 갱신.
-- kind: 'episodic' (대화 기반) | 'profile' (사용자 성향) | 'fact' 등 확장 여지.

create table if not exists memory_chunks (
  id                  bigserial   primary key,
  user_id             text        not null references users(id) on delete cascade,
  char_key            text        not null,
  content             text        not null,
  embedding           vector(1536),
  source_message_ids  bigint[]    not null default '{}',
  salience            real        not null default 1,
  kind                text        not null default 'episodic',
  last_recalled_at    timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists idx_memory_chunks_user_char on memory_chunks (user_id, char_key);
create index if not exists idx_memory_chunks_embedding on memory_chunks using hnsw (embedding vector_cosine_ops);

-- ── memory_summaries ────────────────────────────────────────────────────────
-- 기존 /analyze-memory 결과(jsonb)를 이관할 테이블. 레거시 AsyncStorage `memory_${charName}`
-- 값을 1회 임포트할 대상도 여기.

create table if not exists memory_summaries (
  user_id    text        not null references users(id) on delete cascade,
  char_key   text        not null,
  summary    jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, char_key)
);
