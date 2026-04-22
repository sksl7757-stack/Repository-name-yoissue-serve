# Redline — Stage 1 뉴스 제목 차단 규칙

`redline.js` 의 매칭 규칙·정치인 명단 유지보수 메모. 코드 변경 시 본 문서도 함께 갱신한다.

## 목적

- AI 캐릭터가 생산하는 일일 이슈 대화에서 **윤리·법적 리스크**(자살·미성년 성범죄·잔혹 범죄)와 **정치·이념 편향 리스크**를 앱 런칭 전부터 원천 차단한다.
- 커팅은 **Stage 1 select-news.js**(news_raw 저장 전) 에서 제목 기준으로 수행. Stage 2 (`process-news.js`) 는 영향받지 않으므로 통과한 뉴스만 분석·스코어링된다.

## 파이프라인 연계

- 기본 경로: `select-news.js` 필터 체인 → `SUMMARY_KEYWORDS → BLOCKED_DOMAINS → isOpinion → isWeakNews → isRedlineTitle` 순. 먼저 걸리는 필터에서 continue.
- Memorial(추모일) 분기는 **파이프라인 상위**에서 `isMemorialDay()` 로 완전히 분기하기로 결정. B-5 historical 키워드는 그대로 두고, 추모일에는 별도 경로를 탄다. (별도 구현 건)
- 매칭 시 `{ blocked: true, reason: 'redline_<카테고리명>' }` 반환. 로그에 카테고리명+제목 출력, 루프 종료 후 집계 로그.

## 매칭 방식

- `single(kws)` — 키워드 하나라도 title 에 포함되면 매치.
- `pair(req, wth)` — req 중 하나 + wth 중 하나 **동시** 포함 시 매치.
- `anyCheck(...checks)` — 여러 매칭식을 OR 로 결합.
- `whitelist` — 카테고리 **우선순위**. 해당 키워드 하나라도 title 에 있으면 그 카테고리는 스킵.
- 카테고리 **순서가 우선순위**. 여러 카테고리가 동시 매치되면 앞선 카테고리의 reason 이 기록된다. (현재 B-1 politicians 가 B-9 sanctions 앞에 있어 "트럼프 대러 수출통제" 는 politicians 로 잡힘)

## 카테고리 개요 (13개)

### A — 윤리·법적 (4개, whitelist 없음, 전체 컷)
| 코드 | 이름 | 방식 | 비고 |
|------|------|------|------|
| A-1 | suicide | single | 자살·투신·극단적 선택 계열. "유서" 단독 금지("유서 깊은 사찰" 오탐) → `유서 발견` / `유서 남긴` 으로 좁힘 |
| A-2 | minor_sex | pair | 미성년 주체 + 성범죄 술어 |
| A-3 | brutal_crime | single | 토막살인·흉기 난동 등. "살해 후" / "흉기 찔러" 는 오탐 위험으로 제외. `흉기 휘두른` / `흉기 피습` / `흉기로 찌른` 사용 |
| A-4 | minor_sexual | single | 아청물·딥페이크 성범죄 전용 |

### B — 편향 방어 (9개)
| 코드 | 이름 | 방식 | 비고 |
|------|------|------|------|
| B-1 | politicians | list-lookup | `REDLINE_B_POLITICIANS` 33명. '조국' 만 한국어 조사 경계 regex (`JOGUK_PATTERN`) 적용 — "조국수호단" 같은 복합어는 미매치. |
| B-2 | election | anyCheck(single + 조합) | 선거 고유명사 single + `공약`+(대선/후보/선거) 조합 + `캠프`+(선거/후보) 조합 |
| B-3 | armed_conflict | single | 우크라전·가자지구 등 고유명사 + 휴전/교전/공습 등 일반 동사. 국방 일상 보도도 일부 희생. |
| B-4 | nk_provoke | pair | 북한 주체 + 미사일/도발/핵 등. "발사" 유지 — "위성 발사" 는 소수이므로 감수. |
| B-5 | historical | single | 친일/5·18/세월호/이태원 등. 추모일 분기는 파이프라인 상단에서 처리하므로 여기서는 예외 없음. |
| B-6 | trial_investigation | single + whitelist | 수사/기소/영장. whitelist 에 `수사권 조정`, `제도 개선`, `법 개정`, `법률 개정`, `법안 발의`, `연구 발표`, `정책 발표`, `대책 발표` — 건설적 사회 이슈는 살린다. `조사 결과` 는 의도적 제외 (경찰 조사 결과가 뚫릴 위험). |
| B-7 | faction_clash | anyCheck(single + pair) | 여야 충돌·좌빨 등 강단어는 single. `좌파/우파/보수/진보` 는 학술·일반 용례 오탐 방지로 `vs/공격/결집/대립/충돌/갈등/선동/프레임/포퓰리즘/책임` 과 pair. |
| B-8 | religion_eval | single | 이단·사이비·신천지·전광훈 등 종교 평가 발화. |
| B-9 | sanctions | anyCheck(single + 정치인 조합) | 대러/대이란/대북 제재는 single. `수출통제` + B-1 politicians 조합은 "반도체 수출통제" 는 통과, "트럼프 대러 수출통제" 는 컷. 단 B-1 이 먼저 매치되므로 reason 은 politicians 로 기록. |

## B-1 POLITICIANS 명단 (2026-04-22 기준, 33명)

- **전·현직 대통령(5)**: 이재명(현), 윤석열(전·탄핵), 문재인, 박근혜, 이명박
- **국무총리(1)**: 김민석
- **민주당(4)**: 박찬대, 정청래, 우원식, 추미애
- **국민의힘(10)**: 김용태, 한동훈, 홍준표, 오세훈, 나경원, 유승민, 원희룡, 김문수, 장동혁, 송언석
- **제3지대(5)**: 이준석, 천하람, 안철수, 조국, 김선민
- **영부인(2)**: 김혜경, 김건희
- **해외(8)**: 트럼프, 바이든, 해리스, 푸틴, 시진핑, 김정은, 네타냐후, 젤렌스키

## 리뷰 주기

**정기**: 월 1회.

**이벤트 트리거**: 즉시 명단 점검.
- 개각 / 국무총리 교체
- 주요 당 대표 교체
- 대선·총선 / 재보궐
- 정권 교체
- 탄핵·사임 / 피선거권 박탈
- 해외 대선 (미·중·러 등)

## 모니터링

- `select-news.js` 로그에 카테고리별 블록 집계 출력. 0건 일 때와 폭증할 때 모두 확인.
- 블록 로그(`🚫 [Redline] ... title="..."`) 를 주기 검토하여 오탐·누락 패턴 발견 시 카테고리·키워드 조정.

## 일일 로그 (유저 검토용) — Supabase `redline_logs`

저장소는 Railway 파일시스템(ephemeral) 대신 Supabase `redline_logs` 테이블. 스키마는
`supabase-migrations/002_redline_logs.sql` 참고.

### 컬럼 분리
- `auto_log`   — Stage 1 cron 이 매일 overwrite. 차단/통과 자동 집계.
- `user_notes` — 유저만 편집 (판단·메모·조정 사항). cron 이 절대 건드리지 않음 → 메모 보존.
- `final_title` — Stage 2 (`process-news`) 가 pickBestNews 저장 성공 직후 갱신.

### 데이터 플로우
1. `select-news.js` → `saveAutoLog(date, { collectedCount, blocked, passed })`:
   신규 row 시 user_notes 기본 템플릿 삽입, 기존 row 시 auto_log 만 update.
2. `process-news.js` → `updateFinalSelection(date, title)`:
   final_title 컬럼만 update.
3. 유저 조회/편집은 Express 엔드포인트로:
   - `GET /redline-logs` — 목록 페이지 (날짜별 수집/차단/통과 집계, 클릭 시 해당 날짜 뷰어로 이동).
   - `GET /redline-logs/list` — 목록 JSON ({ logs: [{ date, final_title, collectedCount, blockedCount, passedCount }] }).
   - `GET /redline-log/:date/view` — 브라우저 뷰어 (HTML + marked.js 렌더, 토큰 인증). 상단에 이전/다음 날짜 네비.
   - `GET /redline-log/:date` — JSON ({ auto_log, user_notes, final_title, markdown, prev, next }).
   - `PATCH /redline-log/:date { user_notes }` — 유저 메모 저장.
   - `GET /redline-log/:date/download` — `redline-YYYY-MM-DD.md` 다운로드 (옵시디언 호환).

### 집계 정의
- 수집 = 사전 필터(SUMMARY/BLOCKED/OPINION/WEAK) 통과 후 redline 에 진입한 건수.
- 차단 = redline 블록 건수 (url dedupe 후).
- 통과 = redline 통과 건수 (url dedupe 후, top-30 cut 이전).
- 최종 선정 = Stage 2 `pickBestNews` 선정 결과.

### 인증
환경변수 `REDLINE_LOG_TOKEN` 설정 시 Bearer / `?token=` / localStorage 셋 중 하나로 일치해야 접근 가능. 미설정 시 개방(로컬 개발용 — 프로덕션에는 반드시 설정).

### 확장
순수 함수 `buildAutoLog(...)` / `mergeLog(...)` 는 I/O 없음. 추후 GitHub 자동 push /
옵시디언 동기화 등 exporter 모듈에서 재사용 가능.

## 변경 이력

| 날짜 | 변경 |
|------|------|
| 2026-04-22 | 최초 작성. 13개 카테고리 + B-1 33명 확정. |
| 2026-04-22 | B-3 armed_conflict 에 `종전` 키워드 추가. 이란-미국 종전 협상 무산 뉴스가 최종 선정되어 차단 누락 발견 (`휴전` 은 있었으나 `종전` 없었음). |
