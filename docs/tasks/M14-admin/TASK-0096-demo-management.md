# TASK-0096: 데모 계정 관리

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M14 관리자 |
| 상태 | 완료 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/demo-management` |
| 선행 작업 | M13 완료 |

## 1. 목적

데모 계정 발급 현황과 정리 상태를 확인한다. 데모가 이 서비스의 주 진입 경로이므로 운영 관점에서 모니터링이 필요하다.

## 2. 범위

### 포함
- 데모 계정 목록 (역할·발급 시각·만료 예정·생성 데이터 수)
- 발급 통계 (일별·역할별)
- 강제 만료 처리
- 정리 스케줄러 상태·마지막 실행 결과
- 정리 실패 건 조회·재시도
- 데모 정책 설정 (수명, 초기 데이터 규모, 가상 카드 한도)
- 데모 데이터가 공용 카탈로그에 미친 영향 확인 (데모 판매자 등록 상품 수)

### 제외
- 데모 사용 분석·퍼널

## 3. 요구사항

- [x] 현재 활성 데모 계정을 볼 수 있다
- [x] 강제 만료시킬 수 있다
- [x] 정리 스케줄러 상태를 확인할 수 있다
- [x] 정리 실패 건을 재시도할 수 있다
- [x] 데모 정책을 화면에서 조정할 수 있다

## 4. 설계

**정리 실패 건 조회가 핵심 기능**이다. TASK-0025 의 정리 로직이 실패하면 데이터가 쌓이는데, 로그만으로는 알기 어렵다. 화면에서 실패 건과 사유를 보고 재시도할 수 있어야 한다.

**데모 정책 설정**을 화면에 두는 이유: 수명 24시간이 적절한지는 실제 사용을 보고 조정해야 한다. 배포 없이 바꿀 수 있게 한다.

### 4.1 정리를 여기서 다시 만들지 않는다

강제 만료도 재시도도 **청소기의 문을 지난다.** 지우는 순서는 표 하나에 데이터로 적혀 있고(`demo-cleanup-plan.ts`), 그 순서를 여기서 다시 쓰면 두 경로가 서로 다른 순서로 지우다 외래키에 걸린다 — 그때 **절반만 지워진 계정**이 남는다.

강제 만료는 지우지 않고 **만료 시각을 지금으로 당긴다.** 그러면 다음 정리가 평소의 경로로 집어 간다.

### 4.2 재시도는 「지금 한 번 돌린다」다

실패한 계정은 만료된 채로 남아 있으므로 다음 주기가 **자동으로 다시 집는다** (`demo-cleanup.service.ts` 의 「nothing has to remember it」). F5 의 「재시도 실행」은 그 주기를 기다리지 않는 것이고, 그래서 이 화면이 하는 일은 청소기를 한 번 부르는 것뿐이다.

### 4.3 실패는 표가 아니라 **칸**이다

실패는 그 계정의 지금 상태이지 쌓아 둘 사건이 아니다. 표로 만들면 **이미 정리된 계정의 옛 실패가 영영 남아 목록을 채운다.** 다음 주기가 성공하면 칸은 그냥 비워진다.

시각과 이유는 짝이다 (`User_demo_cleanup_failure_check`) — 이유 없는 실패는 화면이 말할 것이 없다.

### 4.4 수명은 상수가 아니라 **정책 행**이다

`DEMO_ACCOUNT_TTL_HOURS` 는 계약의 상수였는데, 그것으로는 「수명을 1시간으로 바꿔 본다」를 할 수 없다 — 상수를 고치는 것은 배포이고, 데모를 보여 주는 자리에서 필요한 것은 **지금 바꾸는 일**이다.

`AppMeta` 에 두지 않은 이유는 `PointPolicy` 가 이미 적어 두었다: 저 표의 값은 `String` 이라 범위를 DB 가 지킬 수 없다. **수명이 0이나 음수면 발급되는 즉시 만료된 계정이 나오고, 그 증상은 「데모가 안 된다」로만 보인다.** 위도 막는다 — 30일짜리 데모는 데모가 아니라 계정이다.

**이후 발급분에만 적용된다.** 이미 발급된 계정의 만료 시각을 소급해 옮기지 않는다 — 쓰고 있던 사람의 데모가 눈앞에서 사라지는 일이 되고, 그것은 정책 변경이 아니라 사고다.

### 4.5 통계는 두 축을 **함께** 답한다

일별과 역할별을 따로 물으면 두 요청 사이에 발급이 일어나 합이 안 맞는다. 없던 날은 0으로 채운다 — 빈 날을 빼면 그래프가 그 구간을 건너뛰어 그리고, 「이틀 아무도 안 눌렀다」가 「꾸준했다」로 보인다.

## 5. 구현 계획

1. 데모 계정 목록 API·화면
2. 발급 통계
3. 강제 만료
4. 스케줄러 상태·실패 건 조회
5. 재시도
6. 정책 설정 화면

## 6. 완료 기준

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 목록 | `admin-console.spec.ts` 「lists demo accounts and the ones whose cleanup failed」 · 화면은 `demo-page.spec.tsx` 「says how long each account has, and separates the last hour from the rest」 · 「has a word for an account with no expiry at all」 — 만료 시각이 없는 줄을 빈칸으로 두면 「못 읽었다」와 섞인다 · 네 갈래의 판정 자체는 `demo-console.spec.ts` 「separates an account that is already past its time」 · 「separates the last hour from the rest of the life」 가 잰다. **역할 칸은 그리기만 하고 재지 않는다** — 계약이 지키는 것은 배열의 모양뿐이다 | 역할·만료 예정 표시 | [x] |
| F2 | 강제 만료 | `admin-console.spec.ts` 「force-expires by moving the expiry, not by deleting」 — 부른 직후 **계정 줄이 그대로 있는 것**을 단언한다 · 그 뒤를 `demo-cleanup.integration.spec.ts` 「brings the expiry forward so the next sweep collects it」 가 같은 `expireNow` 로 받는다(만료를 당긴 직후에는 데이터가 남아 있고, 다음 청소에 사라진다 — 지우는 순서를 아는 곳은 여전히 한 곳이다) · 화면은 `demo-page.spec.tsx` 「says it moves the expiry rather than deleting the account」 · 「asks once, then calls the door」 · 「reads the list and the statistics again afterwards」 | 정리 대상 전환, 데이터 삭제 | [x] |
| F3 | 스케줄러 상태 | `admin-console.spec.ts` 「answers issuing statistics on both axes」 · `demo-page.spec.tsx` 「says what the last sweep did, not only when it ran」·「says it has never run rather than drawing zeroes」 — **시각만으로는 「돌았다」까지만 말한다.** 0건을 집은 주기와 50건을 집은 주기가 같아 보이면 정리가 밀리는 것을 아무도 모르므로, 스윕이 처리 건수를 `demo.cleanup.lastReport` 에 함께 적는다. 배치가 멈춘 것 자체는 대시보드가 본다 — `dashboard.spec.ts` 「turns a run that stopped moving into stale」 | 마지막 실행 시각·처리 건수 | [x] |
| F4 | 실패 건 | `demo-cleanup.integration.spec.ts` 「writes why it failed onto the account that failed」 — **로그에만 남기면 운영 화면은 정상이라고 말한다.** 실제로 그 상태였고, 이 검사가 그것을 잡는다. 보여 주는 쪽은 `admin-console.spec.ts` 「lists demo accounts and the ones whose cleanup failed」 · `demo-page.spec.tsx` | 실패 건과 사유 표시 | [x] |
| F5 | 재시도 | `demo-page.spec.tsx` 「retries by running the sweep once」 — 이 화면이 하는 일은 청소기를 한 번 부르는 것뿐이라 정리 순서가 두 벌이 되지 않는다 · 「says nothing was there rather than drawing two zeroes」 · 「shows the refusal when the sweep could not run (U6)」 · 재시도가 따로 없어도 되는 이유는 `demo-cleanup.integration.spec.ts` 「collects the others, and the failed one is retried on the next sweep」 가 잰다(실패한 계정은 만료된 채로 남는다). 문 자체(`POST /admin/demo/sweeps`)를 부르는 API 검사는 없고, 화면 검사는 `console-api` 를 대역으로 세운다 | 정리 완료 | [x] |
| F6 | 정책 변경 | `admin-console.spec.ts` 「applies the new lifetime to the next account it issues」 — **정책이 실제로 물리는지가 이 기준의 전부다.** 저장만 재던 검사는 발급이 그 값을 안 보는 상태를 그대로 통과시켰고(실제로 그랬다), 그래서 바꾼 뒤 한 계정을 발급해 만료가 그만큼 뒤인지 본다. 소급하지 않는 쪽은 「changes the lifetime without touching the accounts already issued」, 범위 밖 값은 `DemoPolicy_ttl_check` 가 막는다 | 이후 발급분에 적용 | [x] |
| F7 | 통계 | `admin-console.spec.ts` 「answers issuing statistics on both axes」 — 두 축이 **한 답에** 온다(따로 물으면 그 사이의 발급으로 합이 어긋난다) · 없던 날을 0으로 채우는 것은 `kst-days.spec.ts` 「puts a zero where nothing happened」 · 「returns exactly the asked-for number of days」 · 역할의 순서와 모르는 역할은 `demo-console.spec.ts` 「puts the known roles in the contract’s order, whatever order they arrived in」 · 「keeps a role this console has never heard of, at the end and marked」 · 화면은 `demo-page.spec.tsx` 「answers both axes from one read」 · 「keeps a day nobody issued anything on」 · 「asks for the period the two boxes show」. 서버가 답한 수 자체를 단언하는 검사는 없다 | 일별·역할별 정확 | [x] |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:
- **2장**: P1~P5. **P6 해당 없음**
- **3장 전 항목 적용**
- **4장 해당 없음**

### 6.3 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳, **M14 마일스톤 완료 처리** | [x] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | 정책 변경이 진행 중인 데모 세션에 영향 | 기존 발급분의 만료 시각은 유지하고 신규 발급분부터 적용 |

## 8. 확정된 버전

해당 없음.

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-07 | 완료. 검증에서 결함 셋이 드러났다 — 실패 칸을 **아무도 쓰지 않았고**(화면은 늘 정상이라 말했다), 정책 행을 **아무도 읽지 않았으며**(수명이 여전히 상수였다), 처리 건수는 어디에도 없었다. 셋 다 채우고 각각을 재는 검사를 붙였다 |
