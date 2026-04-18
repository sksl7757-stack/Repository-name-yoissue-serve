# TODO

## 크롤링 콘텐츠 품질 추가 개선 (완료: 2026-04-19)

**수정 내용:**
- process-news.js `fetchArticleContent`: HTML 받자마자 `<style>`, `<script>`, `<!-- -->` 제거 (`stripStyleAndScript`)
- process-news.js `isInvalidContent`: CSS 셀렉터/속성 패턴 감지 추가
- select-news.js `MAJOR_SOURCES`: 연합뉴스TV·채널A·MBN 등 10+ 매체 추가
- select-news.js `STRONG_KEYWORDS`: 국제 정세 핵심어(트럼프/이란/북한/전쟁 등) 추가

---

## 푸터 텍스트 오추출 방지 (완료: 2026-04-19)

**증상:**
- 크롤러가 본문을 못 찾으면 신문사 푸터(저작권/발행인/주소)를 본문으로 추출

**수정 내용:**
- isInvalidContent에 푸터 패턴 추가 (제호, 등록번호, 발행인, Copyright, 무단전재 등)

**관찰 필요:**
- 크롤링 성공률 감소 여부 (엄격해진 만큼 fallback 빈도↑ 가능성)

---

## 유사 기사 중복 제거 (우선순위: 중간)

**증상:**
- 같은 속보 여러 매체가 동시 송출 → 상위 3건이 전부 같은 내용
- 예: "트럼프 이란 호르무즈" 1~3위 동일

**해결 방향 후보:**
- 제목 토큰 Jaccard 유사도 임계값 기반 clustering
- 또는 eventId 기반 중복 제거 강화

**실제 영향도 데이터 수집 후 구현 결정**

---

## scoreImpact.js 가중치 적용 (완료: 2026-04-19)

**발견:**
- select-news.js의 scoreImpactTitle에만 가중치를 넣었으나, 최종 선정에 쓰이는 scoreImpact.js(별도 파일)에는 반영 안 됨
- 지자체 보도자료가 계속 상위 선정되던 진짜 원인

**수정 내용:**
- scoreImpact.js에 INTERNATIONAL 카테고리 추가 (+2점): 트럼프/이란/중동/전쟁 등
- scoreImpact.js에 MAJOR_SOURCES 가중치 적용 (1.0 / 0.6)
- POLICY, SOCIAL 키워드 소폭 확장 (탄핵/총선/참사/사망 추가)

**구조 메모:**
- scoreImpactTitle (select-news.js): 50→30 1차 컷용, 제목 기반
- scoreImpact (scoreImpact.js): 최종 선정용, 제목+본문 기반
- 두 함수가 이제 동일한 가중치 로직 유지

---

## 임팩트 점수 개선 (완료: 2026-04-19)

**변경 내용:**
- STRONG_KEYWORDS 점수 2→1로 감경 (과대평가 방지)
- 소스 가중치 도입: 주요 매체 1.0, 지방지/소규모 0.6
- MAJOR_SOURCES에 연합/YTN/KBS/주요 일간지/경제지 등 20여 개 포함

**효과:**
- 지자체 보도자료가 전국 매체 기사보다 상위에 올라오는 문제 완화
- 예: 고성군청 경제 대응 (×0.6) vs 연합뉴스 경제 뉴스 (×1.0)

**관찰 필요:**
- 통과 기사 수 감소 시 MIN_IMPACT 재조정 필요 (현재 1)
- 지방의 진짜 중요 이슈(지방 선거, 지역 재해 등)가 누락되는지 확인

---

## 사설 종합·큐레이션 기사 필터 (완료: 2026-04-19)

**적용 내용:**
- select-news.js: SUMMARY_KEYWORDS에 종합/사설 키워드 추가
  (이시각주요뉴스, 오늘의주요뉴스, 뉴스센터주요뉴스, 뉴스바이트, 뉴스레터, 사설종합, 언론사설, 오늘의사설)
  ※ '주요뉴스' 단독은 오탐("BBC도 주요 뉴스로 전한 늑구") 위험 → 좁은 패턴만 사용
- select-news.js: BLOCKED_DOMAINS + isBlockedDomain() 추가
  (mediatoday.co.kr, mediawatch.kr — 언론 비평 전문 매체)

**관찰 필요:**
- 다른 언론사의 사설 종합 기사가 뚫리면 BLOCKED_DOMAINS 확장
- 오탐 발생 시 해당 키워드 제거 또는 더 좁은 패턴으로 교체

## 향후 과제
- 제목 핵심 명사의 본문 반복 비율 체크 (제주 아파트 + 제주대 같은 "같은 지역 다른 주제" 대응)
- 제목 ≠ 내용 불일치 감지 (제목은 정치인데 content는 경제 등)

---

## 잡탕/무효 뉴스 필터 개선 (완료: 2026-04-19)

**적용 내용:**
- select-news.js: SUMMARY_KEYWORDS에 묶음 기사 패턴 9개 추가
  (위클리PICK, 주간이슈, TOP3/5/10, 한눈에, 모아보기 등)
- process-news.js: fetchArticleContent에 isInvalidContent 가드 추가
  (브라우저 경고문, 페이월/로그인 요구 페이지 감지)

**남은 위험:**
- "같은 지역 다른 주제" 잡탕 (제주 아파트 + 제주대)은 여전히 뚫릴 수 있음
  → 다음 과제: 제목 핵심 명사의 본문 반복 비율 체크 추가
- JavaScript로 본문 로딩하는 사이트(페이월 우회)는 여전히 본문 추출 실패
  → 현재는 fallback으로 처리되니 큰 문제 아님
