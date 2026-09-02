## 관련 TASK

<!-- 예: docs/tasks/M01-foundation/TASK-0007-dev-workflow.md -->

- [TASK-____](../blob/main/docs/tasks/)

## 무엇을 · 왜

<!-- 무엇을 바꿨고 왜 필요했는지. 구현 방법보다 이유를 적는다. -->

## 완료 기준

TASK 문서 6장을 옮겨 적는 것이 아니라 **실제로 확인한 결과**를 체크한다.
확인하지 않은 항목은 비워 두고 아래 "남은 것"에 이유를 적는다.

### 코드 게이트 ([QUALITY-GATES.md](../blob/main/docs/tasks/QUALITY-GATES.md) 1장)

- [ ] Q1 `pnpm typecheck` — error 0
- [ ] Q2 `pnpm lint` — error 0, warning 0
- [ ] Q3 `pnpm build` — 전 앱 성공
- [ ] Q4 `pnpm test` — 전부 통과
- [ ] Q5 테스트 충실도 — 영역별 기준 (M05 부터)
- [ ] Q6 CI — 4개 job 전부 green
- [ ] Q7 커밋 — Conventional Commits 위반 0

### 해당하는 게이트만

- [ ] 2장 화면 게이트 P1~P6 — 사용자 대상 화면이 있는 경우
- [ ] 3장 API 게이트 A1~A5 — 엔드포인트를 추가한 경우
- [ ] 4장 데이터 게이트 S1~S4 — 스키마를 변경한 경우

### 문서 게이트 (5장)

- [ ] D1 TASK 상태 갱신 + 인덱스 2곳 (`docs/tasks/README.md`, 마일스톤 `README.md`)
- [ ] D2 설계가 바뀌었으면 `docs/design/` 갱신
- [ ] D3 결정이 바뀌었으면 세션 파일 + `DECISIONS.md` 갱신
- [ ] D4 새 환경변수를 `.env.example` 에 추가
- [ ] D5 새로 도입한 라이브러리 버전을 TASK 문서 8장에 기록

## 확인 방법

<!-- 리뷰어가 그대로 실행할 수 있는 명령. 없으면 "해당 없음". -->

```bash

```

## 남은 것 · 후속

<!-- 이 PR 에서 끝내지 않은 것과 그 이유. 없으면 "없음". -->
