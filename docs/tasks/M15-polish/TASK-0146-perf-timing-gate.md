# TASK-0146: 성능 검사의 시간 기준을 러너에서 떼어 낸다 — CI 는 느슨하게, 300ms 는 푸시 전에

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M15 마무리 |
| 상태 | 완료 (2026-09-21) |
| 작성일 | 2026-09-20 |
| 브랜치 | `chore/perf-timing-gate` |
| 선행 작업 | TASK-0097 |

## 1. 목적

2026-09-18, `docs/` 만 바꾼 커밋(`66a83ba`)이 main 의 CI 를 빨갛게 만들었다. 실패한 것은
`orders-performance.spec.ts` 의 「주문 생성 p95 300ms」이고 값은 335ms 였다. 같은 내용의 PR 실행은 통과했다.

| | 표본 30개 루프 | p95 | 결과 |
| --- | --- | --- | --- |
| PR 실행 (같은 코드) | 2,117ms — 1회 약 70ms | 300ms 미만 | 통과 |
| main 푸시 실행 | 5,609ms — 1회 약 187ms | 335ms | 실패 |

같은 코드가 다른 러너에서 2.6배 느렸다. 2026-09-12 에도 `demo-performance.spec.ts` 가 같은 이유로 360ms 를
찍었다. TASK-0097 은 이 흔들림을 알고 `test-api-perf` job 을 따로 뗐지만, 그것은 **우리 검사끼리의** 간섭을
없앤 것이고 공유 러너 자체의 흔들림은 남았다.

문제는 검사가 아니라 **기준을 재는 자리**다. `QUALITY-GATES` A1 의 원문은 「**로컬** 부하 측정 p95 300ms」인데,
구현은 그 300ms 를 남의 VM 위에서 재고 있다. 그 자리에서 300ms 는 보장할 수 없는 숫자다.

끝나면 —

- CI 의 시간 검사는 **러너가 3배 느려도** 빨개지지 않고, 진짜로 망가진 것(트랜잭션 안의 대기, 수 배의 회귀)만 잡는다
- A1 의 300ms 는 원문대로 **로컬에서**, API 코드를 건드린 푸시마다 자동으로 잰다
- 회귀를 잡는 주력은 지금처럼 결정적 검사(문장 수 · `EXPLAIN`)이고, 이 TASK 는 그것을 건드리지 않는다

## 2. 범위

### 포함

- 시간 측정 공통 헬퍼 `apps/api/test/support/timing.ts` — 워밍업 · 표본 · 판정을 한곳에 둔다
- `*-performance.spec.ts` **19개 파일 전부**의 시간 단언 43개를 헬퍼로 옮긴다 — `p95Of` 복사본 15개, 손으로 쓴 p95 계산 3개 파일, 자체 `p95()` 1개 파일
- 판정 모드 두 가지: **엄격**(로컬 기본 — p95 < 예산) · **느슨**(CI 기본 — 중앙값 < 예산 × 3)
- `.husky/pre-push` — API 에 영향을 주는 변경이 담긴 푸시에서만 `test:perf` 를 엄격 모드로 돌린다
- 루트 `pnpm gate` — 관례로만 있던 「PR 직전 전체 게이트」를 명령 하나로 만든다
- `apps/api` 의 `test` 스크립트에서 성능 스펙을 뺀다 (4.5 — 지금은 병렬 워커 사이에서 시간을 재고 있다)
- `vitest-blob-*` 아티팩트 보존 1일 → 3일 (4.6)
- `QUALITY-GATES` A1 의 측정 방법을 구현과 맞춘다

### 제외 (이번에 하지 않는 것)

- 문장 수 · `EXPLAIN` 검사 — 결정적이라 흔들리지 않는다. 손대지 않는다
- 예산 숫자(300 · 200 · 500ms) 자체의 변경
- 셀프 호스티드 러너, 벤치마크 전용 서비스(CodSpeed 등) — 데모 프로젝트에 과하다
- 로컬 측정 결과를 저장소에 남기고 CI 가 확인하는 구조 — 7장 R1 의 대응으로 자리만 적어 둔다
- 운영 p95 의 관측 · 알림 — Render 지표로 볼 수 있지만 별도 TASK 의 일이다
- 웹 쪽 Lighthouse · 번들 예산 — 이번 실패와 무관하다

## 3. 요구사항

### 기능 요구사항

- [x] 시간 단언은 전부 헬퍼를 거친다 — 스펙 파일에 `toBeLessThan(300)` 꼴의 시간 비교가 남지 않는다
- [x] 헬퍼는 표본을 재기 전에 같은 호출을 **2회 버린다** (커넥션 풀 · JIT 의 첫 비용을 표본에서 뺀다)
- [x] 모드는 `PERF_TIMING=strict|loose` 로 고르고, 없으면 `CI` 환경변수 유무로 정한다 (있으면 loose)
- [x] 실패 메시지가 **모드 · 예산 · 중앙값 · p95 · 최댓값**을 함께 말한다 — 「335 < 300」만으로는 플레이크인지 회귀인지 읽을 수 없었다
- [x] `pre-push` 는 푸시되는 커밋이 4.3 의 경로를 건드렸을 때만 돈다. `docs/` 만 바꾼 푸시는 0초다
- [x] 로컬 인프라가 꺼져 있으면 `pre-push` 는 테스트를 시작하지 않고 `pnpm infra:up` 을 안내하며 멈춘다
- [x] `SKIP_PERF=1 git push` 로 건너뛸 수 있고, 건너뛰었다는 한 줄을 남긴다
- [x] `pnpm gate` 는 typecheck → lint → build → test → `test:perf`(엄격) 순으로 돌고 첫 실패에서 멈춘다

### 비기능 요구사항

- `pre-push` 가 도는 푸시의 추가 시간: 2분 이하 (CI 의 `test:perf` 가 약 1분 30초)
- 다른 워크트리 · 다른 `PORT_OFFSET` 에서도 같은 훅이 그대로 돈다 — 포트는 `scripts/ports.mjs` 에서만 얻는다
- 느슨 모드에서 러너가 **3배** 느려도 통과한다 (이번 관측 2.6배에 여유를 둔 값)

## 4. 설계

- 데이터 모델 변경: 없음
- API / 라우트: 없음
- 화면 / 컴포넌트: 없음
- 역할별 권한: 해당 없음

### 4.1 무엇을 어디서 재는가

| 어디서 | 무엇을 | 기준 | 잡는 것 |
| --- | --- | --- | --- |
| CI `test-api-perf` | 문장 수 · `EXPLAIN` | 지금 그대로 | N+1, 인덱스 누락 — 러너와 무관하게 100% |
| CI `test-api-perf` | 시간, **느슨** | 워밍업 후 중앙값 < 예산 × 3 | 트랜잭션 안의 대기, 수 배의 회귀 |
| 로컬 `pre-push` · `pnpm gate` | 시간, **엄격** | 워밍업 후 p95 < 예산 | 70ms → 250ms 같은 미세한 회귀 |
| 운영 | 실제 응답 시간 | (이번 범위 밖) | 사용자가 겪는 값 |

예 — 주문 생성이 평소 70ms 일 때:

- N+1 을 넣었다 → 문장 수 검사가 빨개진다. 시간은 볼 필요도 없다
- 트랜잭션 안에 2초 대기를 넣었다 → 문장 수는 그대로지만 CI 의 900ms(300 × 3)를 넘는다
- 70ms 가 310ms 가 됐다 → CI 의 900ms 는 통과한다. `pre-push` 의 300ms 가 푸시를 막는다
- 러너가 2.6배 느렸다 → 중앙값 182ms < 900ms. **통과한다** (이번 사고의 경우)

### 4.2 헬퍼

```ts
// apps/api/test/support/timing.ts
export function sample(run: (index: number) => Promise<unknown>, options: { samples: number; warmup?: number }): Promise<number[]>
export function samplePrepared<P>(prepare: (index: number) => Promise<P>, run: (prepared: P, index: number) => Promise<unknown>, options): Promise<number[]>
export function expectWithinBudget(durations: readonly number[], budgetMs: number): void
```

- `sample` 은 `warmup`(기본 2)회를 버린 뒤 `samples` 회를 잰다. 표본마다 준비 단계가 있는 검사(주문 생성은
  매번 장바구니를 새로 채운다)는 `samplePrepared` 를 쓴다 — 준비 시간은 재지 않는다
- 두 함수가 넘기는 `index` 는 워밍업부터 **이어지는 번호**다(`0 … warmup + samples - 1`). 표본마다 새 이름 ·
  새 주소가 필요한 루프가 워밍업 호출에서도 겹치지 않는다. 표본 수만큼 픽스처를 미리 깔아 두는 스펙은
  `warmup + samples` 개가 필요하다
- 표본이 0개면 판정하지 않고 던진다. 옛 `p95Of` 는 `?? 0` 으로 **통과**했다
- 파일마다 다른 `SAMPLES`(20 · 30 · 40 · 50)는 그대로 둔다. 각자 이유가 있어 정한 값이다
- 느슨 모드가 p95 가 아니라 **중앙값**을 보는 이유: 표본 30개의 p95 는 값 두 개가 결정한다. 러너가 잠깐
  멈추면 그 둘이 튄다. 중앙값은 열다섯 개가 함께 튀어야 움직인다
- 배수 3 은 상수 하나(`LOOSE_FACTOR`)로 두고, 근거(2026-09-18 의 2.6배)를 주석에 적는다

### 4.3 `pre-push`

`.husky/pre-push` 는 한 줄이고 (`node scripts/pre-push-perf.mjs`), 판단은 스크립트가 한다 — 셸로 쓰면 검사할 수 없다.

1. 표준 입력의 `<local sha> <remote sha>` 쌍에서 푸시될 커밋 범위를 얻는다. 새 브랜치(remote sha 가 0)면
   `origin/main` 과의 merge-base 부터로 본다
2. 범위 안의 변경 파일이 아래 중 하나에 닿으면 돈다
   - `apps/api/src/**` · `apps/api/prisma/**` · `apps/api/test/**`
   - `packages/shared/**` (응답 스키마가 직렬화 비용을 바꾼다)
   - `pnpm-lock.yaml` (Prisma · 드라이버 버전)
3. 인프라 확인 → `PERF_TIMING=strict pnpm --filter @shopping/api run test:perf`
4. `SKIP_PERF=1` 이면 1~3 을 건너뛰고 「성능 검사를 건너뛰었습니다」를 남긴다

`--no-verify` 는 막을 수 없고 막지 않는다. 이 훅은 **잊지 않게 하는 장치**이지 잠금이 아니다 (7장 R1).

### 4.4 `pnpm gate`

```json
"gate": "pnpm typecheck && pnpm lint && pnpm build && pnpm -r --workspace-concurrency=1 --if-present test && PERF_TIMING=strict pnpm test:perf"
```

`QUALITY-GATES` Q1~Q4 와 A1 을 순서대로 도는 것뿐이다. 새 규칙을 만들지 않는다.

**패키지를 하나씩 돌린다 (`--workspace-concurrency=1`).** `pnpm test` 는 서로 의존하지 않는 `shop` · `admin` ·
`seller` 를 동시에 띄우고, 각자 코어 수만큼 jsdom 워커를 띄운다. 이 머신(16코어 · 15.5GB)에서 앱 하나가 vitest
프로세스 17개 · 약 5.7GB 이므로 셋이면 17GB 다 — 첫 `pnpm gate` 가 메모리 부족으로 중단됐다(2026-09-21). 하나씩
돌리면 피크 6.4GB · 254초이고, 동시에 돌릴 때(325초, `CLAUDE.md` 의 실측)보다 빠르다. CI 가 같은 이유로 이미 그렇게
돌린다 (D-223).

### 4.5 `pnpm test` 에서 성능 스펙을 뺀다

조사 중에 발견한 것. CI 의 샤드는 `--exclude '**/*-performance.spec.ts'` 로 성능 스펙을 빼고 돌리는데,
로컬의 `pnpm test`(`vitest run`)는 **빼지 않는다.** 즉 로컬 전체 게이트는 시간 검사를 병렬 워커 여러 개
사이에서 재고 있고, 그것은 TASK-0097 이 CI 에서 피하려던 바로 그 상황이다. `orders-performance.spec.ts` 의
`SAMPLING_BUDGET_MS` 주석이 말하는 「전체 게이트에서 한 번 빨개졌다」도 같은 뿌리다.

`test` 를 `vitest run --exclude '**/*-performance.spec.ts'` 로 바꾸고, 성능 스펙은 `test:perf` 에서만 돈다.
`pnpm gate` 가 둘을 이어서 돌리므로 빠지는 검사는 없다.

### 4.6 아티팩트 보존

이번에 `gh run rerun --failed` 가 두 번째로 실패한 이유: `vitest-blob-*` 의 보존이 1일이라, 하루 지난 실행은
병합 job 이 읽을 리포트가 없다 (`ENOENT: scandir .vitest-reports`). 3일로 늘린다 — 금요일 밤의 실패를 월요일에
다시 돌릴 수 있는 길이다. 그 뒤로는 전체 재실행(`gh run rerun`)이 답이고, 그 사실을 `ci.yml` 주석에 적는다.

## 5. 구현 계획

1. `timing.ts` 와 그 스펙 — 워밍업을 버리는지, 두 모드의 판정, 실패 메시지
2. 성능 스펙 19개를 헬퍼로 옮긴다 (파일당 기계적 치환. 문장 수 · `EXPLAIN` 검사는 건드리지 않는다)
3. `apps/api` 의 `test` 에서 성능 스펙 제외, 루트 `gate` 추가
4. `scripts/pre-push-perf.mjs` 와 그 스펙, `.husky/pre-push`
5. `ci.yml` — 보존 3일, 재실행에 대한 주석
6. `QUALITY-GATES` A1 · D-284 · 인덱스

## 6. 완료 기준 (Definition of Done)

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 시간 단언이 전부 헬퍼를 거친다 | `grep -cE "performance\.now\(\)" apps/api/test/api/*performance.spec.ts` — 스펙이 직접 시계를 읽는 자리 | `demo-performance` 의 콜드 측정 1쌍뿐 | [x] `demo-performance.spec.ts` 의 2건(콜드 측정 한 쌍)뿐. `function p95Of` · 자체 `p95()` 는 0건 |
| F2 | 워밍업이 표본에서 빠진다 | `timing.spec.ts` — 첫 2회만 느린 가짜 호출 | 표본에 느린 값 0개 | [x] `sample › throws the warm-up calls away` — 첫 2회 900ms · 이후 40ms 인 가짜 시계에서 표본 30개가 전부 40ms |
| F3 | 느슨 모드는 3배 느린 러너를 통과시킨다 | `timing.spec.ts` — 예산 300 에 중앙값 800 인 표본 | 통과 | [x] 중앙값 800 통과. 2026-09-18 을 재현한 표본(중앙값 182 · p95 335)은 엄격 실패 · 느슨 통과 |
| F4 | 느슨 모드도 큰 회귀는 잡는다 | `timing.spec.ts` — 예산 300 에 중앙값 1,000 인 표본 | 실패 | [x] 중앙값 1,000 → 실패, 한계 900 |
| F5 | 엄격 모드는 원래 기준 그대로다 | `timing.spec.ts` — p95 310 인 표본 | 실패 | [x] 30개 중 2개가 310 → 실패, 299 → 통과. 튀는 값 **하나**(2,000)는 통과 — p95 가 하는 일이다 |
| F6 | 실제로 빨개진다 | 주문 생성 트랜잭션에 1초 대기를 넣고 `CI=true pnpm --filter @shopping/api run test:perf` | 실패, 되돌리면 통과 | [x] `order.service.ts` 의 트랜잭션 첫 줄에 `SELECT 1 FROM pg_sleep(1)` → `[perf:loose] 중앙값 < 예산 300ms × 3 — 중앙값 1032.8ms · p95 1043.4ms · 최대 2026.5ms (표본 30개)` 로 실패. 되돌린 뒤 `CI=true pnpm test:perf` 19개 파일 · 102개 통과 |
| F7 | 문서만 바꾼 푸시는 훅이 돌지 않는다 | `pre-push-perf.spec` — `docs/**` 만 있는 범위 | 실행 안 함 | [x] 스펙 통과. 실제로도 — `HEAD~3..HEAD`(문서 커밋 셋)를 넣으면 출력 없이 0 |
| F8 | API 를 건드린 푸시는 훅이 돈다 | `pre-push-perf.spec` — `apps/api/src/**` 가 있는 범위 | 실행함 | [x] 스펙 통과 (감시 경로 다섯을 하나씩, 닮은 경로 `apps/api-mocks/` · `packages/shared-x/` · `docs/apps/api/src/` 는 제외) |
| F9 | 인프라가 꺼져 있으면 안내하고 멈춘다 | `pnpm infra:down` 뒤 API 변경을 푸시 | 종료 코드 1 · `infra:up` 안내 | [x] `main` 의 인프라는 다른 작업이 쓰고 있어 내리지 않고, 아무것도 듣지 않는 포트로 확인했다 — `PORT_OFFSET=873` 에 `ed18629`(API 변경) 범위: postgres `localhost:6305` · meilisearch `localhost:8573` 연결 안 됨 · `pnpm infra:up` 안내 · 종료 코드 1. 검사는 시작되지 않았다 |
| F10 | CI 에서 같은 검사가 연속으로 안정적이다 | PR 의 `test-api-perf` 를 5회 재실행 | 5회 통과 | [x] PR #160 의 실행 35563111244 — 최초 + 재실행 5회, **6회 전부 102개 통과**. 6.1b |

### 6.1a 실측 (2026-09-21, 로컬 · WSL2)

| 무엇을 | 결과 |
| --- | --- |
| `PERF_TIMING=strict pnpm test:perf` **10회 연속** | 10회 전부 19개 파일 · 102개 통과. 매회 101~104초 |
| `CI=true pnpm test:perf` (느슨) | 통과, 104초 |
| `timing.spec.ts` | 21개 통과 — 시계를 손으로 움직인다. 흔들리는 시간에 대한 스펙이 벽시계에 기대지 않는다 |
| `pre-push-perf.spec.ts` | 47개 통과 |

**R2 의 판단 — 훅에 재시도를 넣지 않는다.** 엄격 판정이 로컬에서 10회 연속 한 번도 흔들리지 않았다. 흔들림의
가장 큰 원인이 워밍업 없는 첫 호출이었다는 뜻이다.

**옮기면서 드러난 것.**

- 옛 `p95Of` 복사본은 **공식이 둘**이었다. 일부는 `ceil(n × 0.95) - 1`, 나머지는 `floor(n × 0.95)` — 뒤쪽은
  표본 20개에서 **최댓값**을 p95 라고 읽는다. 헬퍼가 앞쪽(nearest-rank) 하나로 통일했다
- 워밍업 2회는 **실제 호출**이다. 한 번만 쓸 수 있는 픽스처를 표본 수만큼 깔아 두던 두 곳을 늘렸다 —
  쿠폰 코드 발급의 구매자(`coupon-performance`), 발행할 초안(`products-performance`). 둘 다 `SAMPLES + WARMUP_RUNS`
- 루프가 아니라 **단발 측정**이던 두 곳(`admin-performance` 의 대기열 200ms, `stock-ledger-performance` 의 대사
  300ms)은 표본 1개로 옮겼다. 워밍업을 버린 뒤의 한 번이다
- 새 워크트리에서 `search-performance` 가 401 로 실패했다. 시간이 아니라 `.env` 의 `MEILI_MASTER_KEY` 가 없어서였다.
  훅은 포트가 열려 있는지만 보므로 이 경우를 미리 말해 주지 못한다 — 워크트리를 만들면 `.env` 를 함께 옮긴다

### 6.1b CI 에서 여섯 번 (2026-09-21, PR #160 · 실행 35563111244)

`test-api-perf` 를 다섯 번 다시 돌렸다. 매번 다른 러너다.

| 시도 | 주문 생성 루프 (워밍업 · 준비 포함 32회) | `orders-performance` 파일 | 결과 |
| --- | --- | --- | --- |
| 1 | 2,323ms | 8,808ms | 102 통과 |
| 2 | 2,264ms | 8,602ms | 102 통과 |
| 3 | 3,711ms | 11,690ms | 102 통과 |
| 4 | 2,638ms | 9,186ms | 102 통과 |
| 5 | 4,099ms | 10,264ms | 102 통과 |
| 6 | 2,328ms | 8,751ms | 102 통과 |

같은 코드의 같은 루프가 러너에 따라 **1.8배**(2,264 → 4,099ms) 달랐다. 2026-09-18 에 `main` 을 빨갛게 한 것과 같은
종류의 흔들림이고, 느슨한 판정은 여섯 번 다 그것을 지나갔다.

그리고 이 PR 의 첫 푸시에서 `pre-push` 가 실제로 돌았다 — API 에 닿는 파일 22개를 감지했고, 엄격 검사 19개 파일 ·
102개를 106초에 통과한 뒤 푸시가 나갔다.

### 6.2 품질 게이트 (공통 · 모든 TASK 적용)

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| Q1 | 타입 검사 | `pnpm typecheck` | error 0 | [x] `pnpm gate` 의 첫 단계 |
| Q2 | 린트 | `pnpm lint` | error 0, warning 0 | [x] |
| Q3 | 빌드 | `pnpm build` | 성공 | [x] 세 앱 컴파일 성공 |
| Q4 | 단위 테스트 | `pnpm test` | 전부 통과 | [x] 전 패키지 순차 실행 — 9,354개 통과 · 6개 skip, 254초 (shared 103 · ui 961 · api 4,435 · api-mocks 486 · admin 1,166 · seller 895 · shop 1,308) |
| Q5 | 신규/변경 코드 커버리지 | 커버리지 리포트 | 80% 이상 | [x] `src/` 를 바꾸지 않는다. CI 의 병합 커버리지 문턱 통과 |

### 6.3 성능 · 접근성 (사용자 화면이 있는 TASK)

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| P2 | API 응답 | `PERF_TIMING=strict pnpm --filter @shopping/api run test:perf` (로컬) | 전부 통과 — 예산은 바꾸지 않는다 | [x] 10회 연속 + 푸시 때 1회 (6.1a · 6.1b) |

> P1 · P3 · P4 해당 없음 — 화면을 바꾸지 않는다.

### 6.4 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 이 문서의 상태를 `완료` 로 변경하고 `docs/tasks/README.md` 인덱스 갱신 | [x] |
| D2 | D-284 「시간 기준은 로컬에서, CI 는 느슨하게」를 세션 파일과 `DECISIONS.md` 에 기록 | [x] `2026-09-20-perf-timing-gate.md` · `DECISIONS.md` 「CI 게이트」 세 줄 |
| D3 | 해당 없음 — `PERF_TIMING` · `SKIP_PERF` 는 앱 환경변수가 아니다. `QUALITY-GATES` A1 에 적는다 | [x] |
| D4 | `QUALITY-GATES` A1 의 측정 방법 갱신, TASK-0097 F3 에 이 TASK 로의 링크 | [x] `development.md` 의 훅 표 · 우회, `CLAUDE.md` 의 마지막 확인, `HANDOFF.md` 의 함정 표도 함께 |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | 훅은 `--no-verify` · `SKIP_PERF=1` 로 건너뛸 수 있다. 엄격한 300ms 가 아무에게도 강제되지 않는 날이 생긴다 | 받아들인다. CI 의 느슨한 검사가 큰 회귀를 막고, PR 직전 `pnpm gate` 가 한 번 더 잰다. 더 강하게 하려면 로컬 측정 결과를 파일로 남기고 CI 가 「이 커밋의 기록이 있는가」를 확인하는 구조가 있다 — 지금은 만들지 않는다 |
| R2 | 로컬도 흔들린다 (WSL2 · 브라우저 · 도커). 엄격 모드가 로컬에서 플레이크를 내면 훅이 미움받고 꺼진다 | **재시도를 넣지 않았다.** 로컬 10회 연속 실행이 전부 통과했다(6.1a). 나중에 흔들리기 시작하면 그때 실패 메시지의 중앙값으로 가른다 — 중앙값이 예산 안이면 머신, 함께 올랐으면 회귀 |
| R3 | 배수 3 이 너무 느슨해 2배짜리 회귀가 CI 를 지난다 | 의도한 것이다. 그 구간은 로컬 엄격 모드의 몫이다. CI 에서 관측한 흔들림이 2.6배였으므로 3 미만은 다시 플레이크가 된다 |
| R4 | 다른 워크트리에서 푸시할 때 포트가 다르다 (5432~5434 는 다른 프로젝트가 쓴다) | 훅은 포트를 직접 알지 않는다. `scripts/ports.mjs` 가 그 워크트리의 `PORT_OFFSET` 으로 답한다 |
| Q1 | `pnpm-lock.yaml` 변경을 훅의 조건에 넣을 것인가 — 의존성만 올린 푸시마다 2분이 든다 | 넣는 쪽으로 적었다. Prisma · pg 드라이버 업그레이드가 시간에 가장 크게 닿는 변경이다 |

## 8. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-20 | 최초 작성 — 2026-09-18 main CI 실패(`66a83ba`, 실행 35359933228) 조사에서 출발 |
| 2026-09-21 | 완료 — CI 에서 여섯 번(6.1b), 푸시에서 훅이 실제로 돈 것까지 확인 |
| 2026-09-21 | `gate` 가 패키지를 하나씩 돌리게 했다 — 첫 실행이 세 웹 앱을 동시에 띄우다 메모리 부족으로 중단됐다 (4.4) |
| 2026-09-21 | 승인 · 착수. 대상을 바로잡았다 — 초안은 `toBeLessThan(300)` 꼴만 세어 15개 파일 · 35개라 적었는데, 상수(`P95_BUDGET_MS`)나 자체 `p95()` 로 재는 스펙까지 **19개 파일 · 43개**다. F1 의 측정을 「스펙이 직접 시계를 읽는 자리」로 바꿨다 |
