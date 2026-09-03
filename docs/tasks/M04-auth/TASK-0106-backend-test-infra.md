# TASK-0106: 백엔드 통합 테스트 기반

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M04 인증·계정 |
| 상태 | 승인됨 |
| 작성일 | 2026-09-03 |
| 브랜치 | `feature/backend-test-infra` |
| 선행 작업 | TASK-0007, TASK-0020 |

## 1. 목적

**백엔드 테스트가 실제 PostgreSQL 에 대해 돌게 만든다.**

지금은 물리적으로 불가능하다. `.github/workflows/ci.yml` 의 `test` job 에는 postgres 서비스가 없다. 그래서 TASK-0020 이 만든 부분 유니크 인덱스와 CHECK 제약은 `apps/api/src/prisma/schema-guards.spec.ts` 가 **마이그레이션 파일에 그 SQL 문자열이 남아 있는지**만 검사한다. 누가 지우는 것은 잡지만 **조건을 잘못 고쳐도 통과한다** — `WHERE "isDefault"` 를 `WHERE NOT "isDefault"` 로 바꿔도 문자열 검사는 통과할 수 있고, 실제로 동작하는지는 사람이 손으로 psql 을 쳐서 확인한 것이 전부다 (D-207).

이 작업이 끝나면 다음을 **테스트로** 말할 수 있다.

- 재고 1개에 동시 요청 2건이 들어오면 하나만 성공한다 — 지금은 이 문장을 검증할 수단이 아예 없다
- `Address_userId_default_key` 가 두 번째 기본 배송지를 **DB 가** 거부한다
- 만료·정산 마감처럼 시각에 의존하는 로직을 고정 시각으로 재현할 수 있다

**M05 부터 백엔드 커버리지 게이트(라인 80%)가 적용된다** (QUALITY-GATES Q5). 커버리지를 실 DB 없이 채우면 Prisma 를 모킹하는 테스트가 양산되고, 그건 정확히 검증에서 빠져야 할 부분만 빠뜨린다. **그래서 M05 이전에 있어야 한다.**

## 2. 범위

### 포함

- **CI 에 PostgreSQL 서비스 컨테이너 추가** — 이미지 태그는 `docker-compose.yml` 과 동일 (`postgres:17.11-alpine`)
- **워커별 데이터베이스 격리** — 템플릿 DB 에 마이그레이션 1회 적용 후 `CREATE DATABASE ... TEMPLATE ...` 로 복제
- **테스트 사이 `TRUNCATE ... RESTART IDENTITY CASCADE`** — 테이블 목록은 `information_schema` 에서 조회
- 통합 테스트 하네스 — Nest 앱 부팅, 실 HTTP 요청, 워커 DB 연결, 정리
- **동시성 테스트 헬퍼**와 **경합 재현을 증명하는 음성 대조군**
- **시간 주입** — `Clock` 포트와 고정 시각 테스트 대역, `new Date()` 직접 호출 금지 린트 규칙
- **외부 시스템 대역 규약의 코드화** — Meilisearch·토스·Google OAuth·R2 는 모킹, PostgreSQL·가상카드는 실제
- 서비스·리포지토리 테스트 작성 규약 (문서 + 하네스 API)
- `schema-guards.spec.ts` 의 제약 검사를 **실 DB 검증으로 승격** (QUALITY-GATES 4장 S5)
- 커버리지 프로바이더 설치와 `pnpm test:coverage` — **임계값은 켜지 않는다** (M05 부터)

### 제외 (이번에 하지 않는 것)

- **커버리지 임계값 강제** — M05 의 첫 TASK 가 켠다. 여기서는 리포트가 나오는 것까지
- **프론트 모킹·계약 고정** — TASK-0107. 이 TASK 는 계약 게이트 C3(백엔드 실제 응답을 zod 로 parse)의 **실행 경로만** 만든다
- **E2E** — TASK-0099 (Playwright, 실 스택 전부)
- **Meilisearch 를 실제로 띄우는 테스트** — 인덱싱 파이프라인 TASK(TASK-0038)에서 다룬다. 여기서는 모킹 대역만 정한다
- **새 도메인 엔드포인트** — 하네스 시범 적용 대상은 기존 `GET /api/v1/health` 와 TASK-0020 의 스키마다
- **CI 병렬 shard 분할** — 테스트 수가 지금 규모에서는 이득이 없다. F7 의 시간 상한을 넘기면 그때 별도 TASK

## 3. 요구사항

### 기능 요구사항

- [ ] `pnpm test` 한 번으로 로컬과 CI 가 **같은 방식**으로 돈다 (로컬은 `pnpm infra:up` 이 선행)
- [ ] 워커를 여러 개 띄워도 서로의 데이터를 보지 않는다
- [ ] 각 테스트는 빈 DB 에서 시작한다 (행 0, 시퀀스 1부터)
- [ ] 동시 요청 2건을 **서로 다른 커넥션**으로 만들 수 있다
- [ ] 위반하는 INSERT·UPDATE 가 DB 에서 거부되는 것을 확인할 수 있다
- [ ] 현재 시각을 고정한 상태로 만료 로직을 테스트할 수 있다
- [ ] 인프라가 안 떠 있으면 **침묵 skip 이 아니라** 원인과 해결법을 말하고 실패한다

### 비기능 요구사항

- 로컬 `pnpm test` 전체 90초 이하 (4 워커 기준)
- CI `test` job 3분 이하, CI 전체 wall clock 5분 이하
- 테스트 DB 생성 비용은 워커당 200ms 이하 (템플릿 복제는 파일 복사)

## 4. 설계

### 4.1 왜 트랜잭션 롤백 격리를 쓰지 않는가

가장 흔한 방식 — 테스트 전체를 트랜잭션으로 감싸고 끝에 롤백 — 은 **쓰지 않는다.** PostgreSQL 17.11 로 실측한 근거는 D-207 에 있다.

| 확인한 것 | 결과 | 무엇이 깨지는가 |
| --- | --- | --- |
| 커밋 전 다른 커넥션에서 조회 | **0행** (커밋 후 1행) | 동시 요청 상황을 만들 수 없다. 같은 커넥션으로 두 번 부르면 순차 실행되어 **경합이 재현되지 않는다** |
| 트랜잭션 안에서 `BEGIN` | `WARNING: there is already a transaction in progress` | 중첩 트랜잭션이 없다. 프로덕션 코드의 트랜잭션이 savepoint 로 강등된다 |
| 질의 후 격리 수준 지정 | `ERROR: SET TRANSACTION ISOLATION LEVEL must be called before any query` | `Serializable` 이 필요한 로직을 테스트할 수 없다 |
| `pg_advisory_xact_lock` 중간 해제 | `WARNING: you don't own a lock of type ExclusiveLock` / `f` | 어드바이저리 락이 바깥 트랜잭션 범위로 늘어난다 (카테고리 트리 이동) |

즉 **테스트를 트랜잭션에 넣으면 트랜잭션의 동작 자체가 프로덕션과 달라진다.** 이 프로젝트가 반드시 검증해야 할 것 — 초과판매 방지(TASK-0048), 잔액 행 잠금(TASK-0053·0076), 트리 이동(TASK-0028), 결제 멱등(TASK-0056), 정산 배치(TASK-0080) — 이 전부 여기 걸린다.

**폐기한 안**: "기본은 롤백, 동시성 테스트만 별도". 테스트를 쓸 때마다 어느 쪽인지 판단해야 하고, 판단을 틀리면 **통과하는데 아무것도 증명하지 않는 테스트**가 되며 그것이 눈에 띄지 않는다. 규칙이 하나여야 틀릴 여지가 없다.

### 4.2 격리 — 템플릿 복제 + TRUNCATE

두 층으로 나눈다. **워커 사이는 데이터베이스로, 테스트 사이는 TRUNCATE 로.**

```
globalSetup (실행당 1회, 메인 프로세스)
  1. 유지보수 DB(postgres)에 pg 클라이언트 1개로 접속
  2. 마이그레이션 지문 계산 — prisma/migrations/** 의 SHA-256
  3. 템플릿 DB shopping_test_tpl
       지문이 같으면            → 그대로 재사용 (로컬 재실행이 빨라진다)
       다르거나 없으면          → DROP → CREATE → `prisma migrate deploy` → 지문 기록
  4. 템플릿 커넥션을 닫는다  ← CREATE DATABASE ... TEMPLATE 의 전제
  5. i = 1..maxWorkers
       DROP DATABASE IF EXISTS shopping_test_w<i> (FORCE)
       CREATE DATABASE shopping_test_w<i> TEMPLATE shopping_test_tpl
  6. 유지보수 커넥션을 닫는다

setupFiles (워커 프로세스마다)
  DATABASE_URL = ...(5432 + PORT_OFFSET)/shopping_test_w${VITEST_POOL_ID}

useDatabase()  (DB 를 쓰는 describe 가 명시적으로 호출)
  beforeEach → TRUNCATE 전 테이블 RESTART IDENTITY CASCADE
  afterAll   → 이 스펙이 연 커넥션 반납
```

**`VITEST_POOL_ID` 를 쓴다.** Vitest 4 는 `VITEST_WORKER_ID`(워커 고유·단조 증가)와 `VITEST_POOL_ID`(1 ~ `maxWorkers`) 를 모두 준다. 워커가 재활용되면 워커 ID 는 계속 늘어나므로, DB 를 **유한 개**로 유지하려면 pool ID 여야 한다.

**템플릿 복제가 싼 이유.** `CREATE DATABASE ... TEMPLATE` 은 SQL 을 다시 실행하지 않고 데이터 디렉터리를 **파일 복사**한다. 마이그레이션 2개짜리 지금 스키마의 템플릿은 8MB 남짓이라 복제 1회가 100~200ms 다. 워커마다 `migrate deploy` 를 돌리면 CLI 부팅만 워커당 1.5초씩 붙는다.

**전제 하나**: `CREATE DATABASE ... TEMPLATE` 은 **원본에 다른 세션이 붙어 있으면 실패**한다. 그래서 위 3~4 단계에서 템플릿 커넥션을 명시적으로 닫고, 5 단계의 `DROP ... (FORCE)` 로 이전 실행이 죽으면서 남긴 커넥션을 정리한다.

**TRUNCATE 대상은 조회해서 만든다.** 목록을 손으로 적으면 M05 에서 테이블이 20개 늘어날 때마다 여기를 고쳐야 하고, 빠뜨린 테이블은 조용히 데이터를 남긴다.

```sql
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_type = 'BASE TABLE'
   AND table_name <> '_prisma_migrations';
```

한 문장으로 모아 `TRUNCATE TABLE "A","B",... RESTART IDENTITY CASCADE` 를 실행한다. 목록은 워커 프로세스마다 1회만 조회해 캐시한다 (한 실행 안에서 스키마는 고정이다). `_prisma_migrations` 를 지우면 다음 실행의 `migrate deploy` 가 어긋나므로 제외한다.

**전부 진짜 커밋이다.** 트랜잭션·잠금·격리 수준이 프로덕션과 같은 의미로 동작하고, 초기화된 상태에서 시작하는 성질은 그대로다.

### 4.3 로컬과 CI 에서 각각 어떻게 도는가

| | 로컬 | CI |
| --- | --- | --- |
| PostgreSQL | `pnpm infra:up` 의 컨테이너 (워크트리별 `COMPOSE_PROJECT_NAME`) | `test` job 의 서비스 컨테이너 |
| 이미지 | `postgres:17.11-alpine` | **같은 태그** |
| 포트 | `5432 + PORT_OFFSET` | `5432` (`PORT_OFFSET` 미설정 → 0) |
| `DATABASE_URL` | `derived-env.ts` 가 `PORT_OFFSET` 에서 파생 | 같은 코드가 파생. `.env` 가 없어도 `derived-env.ts` 의 폴백(`shopping`/`shopping`/`shopping`)이 서비스 컨테이너 설정과 일치한다 |
| 실행 명령 | `pnpm test` | `pnpm test` |
| 테스트 DB | `shopping_test_tpl`, `shopping_test_w1..N` | 동일 |

**로컬과 CI 의 차이는 "컨테이너를 누가 띄우는가" 하나뿐이다.** 명령도, 이미지도, DB 이름도 같다.

CI 워크플로에 붙는 것:

```yaml
  test:
    services:
      postgres:
        image: postgres:17.11-alpine       # docker-compose.yml 과 동일 태그
        env: { POSTGRES_USER: shopping, POSTGRES_PASSWORD: shopping, POSTGRES_DB: shopping }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U shopping -d shopping"
          --health-interval 2s --health-timeout 3s --health-retries 20
```

**버전 드리프트 방지.** 워크플로 YAML 은 `docker-compose.yml` 을 읽을 수 없으므로 태그가 두 곳에 적힌다. 마이너 버전이 어긋나면 **로컬에서 통과한 것이 CI 에서 깨지고**, 원인을 찾는 데 하루가 든다. 두 파일의 `postgres:` 태그를 비교하는 스펙을 둔다 — 검증 대상이 파일 그 자체이므로 파일을 읽는 것이 옳은 경우다 (`schema-guards.spec.ts` 의 "마이그레이션이 배포 산출물이다" 와 같은 논리).

**인프라가 안 떠 있으면 실패한다.** `globalSetup` 이 접속에 실패하면 5초 안에 한국어로 원인과 `pnpm infra:up` 을 안내하고 종료한다. **DB 가 없을 때 자동 skip 하는 안은 폐기한다** — 아무것도 검증하지 않은 초록은 이 TASK 가 없애려는 바로 그 상태다.

### 4.4 통합 테스트 하네스

```ts
// apps/api/test/harness — 세 조각
const db  = useDatabase()          // 워커 DB 연결 + beforeEach TRUNCATE
const app = await useApiApp({ db, clock: fixedClock('2026-09-03T00:00:00Z') })
const res = await app.get('/health', healthResponseSchema)   // zod parse 포함
```

**HTTP 는 실제로 부른다.** Nest 앱을 `listen(0)` 으로 임시 포트에 띄우고 `@shopping/shared` 의 `createApiClient` 로 호출한다.

| 후보 | 판단 |
| --- | --- |
| **Nest `listen(0)` + `createApiClient`** | **채택.** 새 의존성이 0이고, 프론트가 쓰는 바로 그 클라이언트를 통과하므로 **계약 게이트 C3 가 구조적으로 성립**한다 — 응답이 스키마와 어긋나면 단언을 쓰지 않아도 `ApiClientError { kind: 'malformed_response' }` 로 터진다 |
| supertest | 탈락. 널리 쓰이지만 자체 파서로 본문을 읽으므로 응답이 `createApiClient` 를 지나가지 않는다. C3 가 "스펙마다 잊지 않고 parse 를 쓴다"는 규율에 의존하게 된다 |
| `app.getHttpServer()` 직접 호출 | 탈락. 소켓을 열지 않아 빠르지만, 동시 요청이 진짜 동시가 되지 않고 쿠키·CORS·헤더가 검증 범위에서 빠진다 |

**쿠키는 손으로 다룬다.** Node 의 `fetch` 에는 쿠키 저장소가 없으므로 응답의 `set-cookie` 를 읽어 다음 요청의 `Cookie` 헤더에 넣는다. 불편해 보이지만 TASK-0022 가 필요로 하는 것 — `HttpOnly`·`SameSite`·`Path`·`Max-Age` 가 정확히 무엇인지 — 을 **단언 대상으로 드러내므로** 오히려 맞다.

### 4.5 동시성 테스트 — 이 TASK 의 존재 이유

재고 1개에 동시 요청 2건이 들어오면 하나만 성공해야 한다. 지금 이 문장은 **테스트로 쓸 수가 없다.**

```ts
const results = await concurrently(2, () => reserveStock({ variantId, quantity: 1 }))
expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
expect(await stockOf(variantId)).toBe(0)          // 음수가 되지 않는다
```

`concurrently(n, fn)` 은 n 개를 동시에 시작해 `allSettled` 로 모은다. 두 호출은 pool 의 **서로 다른 커넥션**을 쓴다 (`DATABASE_POOL_SIZE` 기본 10). 롤백 격리였다면 둘 다 같은 트랜잭션 안이라 순차 실행되고, 이 단언은 **통과하지만 아무것도 증명하지 않는다.**

**하네스가 경합을 실제로 만드는지 자체를 증명한다 (음성 대조군).** 위 단언은 코드가 안전해서 통과한 것일 수도, 두 요청이 실제로는 겹치지 않아서 통과한 것일 수도 있다. 구분하려면 **틀린 구현이 확실히 실패하는 것**을 보여야 한다.

```
커넥션 A: BEGIN; SELECT stock FROM ... ;            -- 1 을 읽는다
커넥션 B: BEGIN; SELECT stock FROM ... ;            -- 역시 1 을 읽는다
커넥션 A: UPDATE ... SET stock = 0; COMMIT;
커넥션 B: UPDATE ... SET stock = 0; COMMIT;         -- lost update
결과: 예약 2건, 재고 0  → 초과판매 1건
```

읽기·쓰기 순서를 테스트가 직접 지시하므로 **결정적**이다(flaky 하지 않다). 이 대조군이 초과판매를 재현하고 실제 구현은 재현하지 않는다면, 하네스가 경합을 만든다는 것과 구현이 그것을 막는다는 것이 **둘 다** 증명된다.

이 두 짝(실제 구현 / 음성 대조군)이 A7(동시 요청) 게이트를 받는 모든 TASK 의 본보기가 된다 — TASK-0048 재고 예약, TASK-0053 가상카드 잔액, TASK-0056 결제 웹훅 멱등, TASK-0076 적립금 원장.

### 4.6 대역 규약 — 무엇을 실제로 쓰는가

[QUALITY-GATES 6장](../QUALITY-GATES.md#6-테스트-대역-규약)이 규약이고, 이 TASK 는 그것을 **코드로 강제**한다.

| 대상 | 대역 | 하네스에서의 형태 |
| --- | --- | --- |
| **PostgreSQL** | **실제** | 워커 DB. 대체 불가 — Prisma 를 모킹하는 순간 불변식 검증이 통째로 빠진다 |
| **가상 카드** | **실제** | 우리 도메인이다. 외부가 아니다 |
| Meilisearch | 모킹 | `SearchPort` 인터페이스의 인메모리 구현. 인덱싱 파이프라인 TASK 만 실제를 쓴다 |
| 토스페이먼츠 | 모킹 | `PaymentProvider` 의 테스트 구현. 실패·타임아웃·중복 웹훅을 우리가 만들 수 있어야 한다 |
| Google OAuth | 모킹 | 토큰 검증 포트의 테스트 구현 |
| Cloudflare R2 | 모킹 | presigned URL 생성은 순수 로직으로 분리해 그대로 검증 |
| **시간** | **주입** | 4.7 |

**모킹 대상은 전부 포트 뒤에 둔다.** 프로덕션 코드가 SDK 를 직접 부르면 테스트에서 갈아끼울 지점이 없다. 각 도메인 TASK 가 자기 포트를 정의하고, 이 TASK 는 **테스트 모듈에 포트를 갈아끼우는 방법**만 제공한다.

### 4.7 시간 주입

만료·정산 마감처럼 시각에 의존하는 로직은 **현재 시각을 인자로 받는다.**

```ts
// 순수 로직 — 인자로 받는다
export function isDemoExpired(user: DemoUser, now: Date): boolean

// 서비스 — Clock 포트를 주입받아 아래로 넘긴다
constructor(@Inject(CLOCK) private readonly clock: Clock) {}
```

프로덕션은 시스템 시계를, 테스트는 `fixedClock('2026-09-03T00:00:00Z')` 를 바인딩한다. `vi.setSystemTime` 으로 대신하지 않는 이유: **DB 의 `now()` 는 따라오지 않는다.** `DEFAULT now()` 컬럼과 애플리케이션 시각이 어긋나면 만료 판정이 테스트에서만 맞는다. 시각을 인자로 넘기면 DB 에 저장되는 값도 같은 시각이 된다.

**규칙을 린트로 강제한다** — `apps/api/src/**` 에서 `new Date()` · `Date.now()` 직접 호출을 금지하고 clock 모듈만 예외로 둔다. 규약을 문서에만 적으면 반년 뒤 절반은 지켜지지 않는다.

### 4.8 S5 — 파일 읽기에서 실제 검증으로

`schema-guards.spec.ts` 의 제약 검사 5개를 실 DB 시도로 옮긴다. 지금 코드의 주석은 "CI 에 Postgres 가 없어서 파일을 읽는다"고 스스로 밝히고 있고, 그 전제가 이 TASK 로 사라진다.

| 제약 | 거부되어야 하는 것 | 허용되어야 하는 것 (조건이 잘못 적히면 여기서 잡힌다) |
| --- | --- | --- |
| `Address_userId_default_key` | 같은 사용자의 두 번째 `isDefault` 배송지 → `23505` | 같은 사용자의 기본 아닌 배송지 여러 개 |
| `User_googleSub_active_key` | 같은 `googleSub` 를 가진 살아 있는 계정 2개 → `23505` | 탈퇴(`deletedAt` 있음) 계정과 같은 `googleSub` 로 재가입 / `googleSub` 가 NULL 인 데모 계정 여러 개 |
| `User_demo_expiry_check` | `isDemo=true` + `demoExpiresAt=NULL` → `23514` | `isDemo=true` + 만료 시각 있음, `isDemo=false` + NULL |
| `User_google_identity_check` | 살아 있는 실계정 + `googleSub=NULL` → `23514` | 데모 계정, 탈퇴 계정 |
| `Seller_commissionRateBp_check` | `-1`, `10001` → `23514` | `0`, `10000`, `NULL` |

**"허용되어야 하는 것" 쪽이 문자열 검사가 못 잡던 부분이다.** 부분 유니크 인덱스의 술어를 잘못 적으면 위반은 여전히 거부되지만 정상 케이스가 막힌다 — 예를 들어 `WHERE "isDefault"` 를 빠뜨리면 사용자가 배송지를 하나밖에 못 갖는다. 양쪽을 다 시도해야 술어가 검증된다.

Prisma 를 거치지 않고 **raw SQL 로 시도한다.** 애플리케이션 검증이 먼저 걸리면 DB 가 거부했는지 애플리케이션이 거부했는지 구분할 수 없고, S5 가 요구하는 것은 정확히 그 구분이다. SQLSTATE(`23505` 유니크 위반 / `23514` CHECK 위반)와 **제약 이름**까지 단언한다.

파일을 읽던 제약 단언 5개는 **삭제한다.** 실 DB 검증이 상위 호환이다 — 인덱스가 사라지면 위반 INSERT 가 성공해버려 그대로 실패한다. 검사를 두 벌 두면 어느 쪽이 진짜인지 모호해진다. `schema-guards.spec.ts` 에는 진짜로 파일이 대상인 것만 남긴다: 모든 마이그레이션이 SQL 을 동반하는가, `Float`/`Decimal` 컬럼이 없는가(S4).

### 4.9 서비스·리포지토리 테스트 작성 규약

| # | 규칙 | 이유 |
| --- | --- | --- |
| T1 | Prisma·리포지토리를 **모킹하지 않는다** (A6) | 모킹하는 순간 이 TASK 가 만든 것이 전부 무의미해진다 |
| T2 | 픽스처는 **팩토리 함수**로 만든다 (`createUser({ isDemo: true })`) | 스키마가 늘 때 한 곳만 고친다. 테스트가 관심 있는 필드만 인자로 드러난다 |
| T3 | 다른 테스트가 남긴 데이터를 **전제하지 않는다** | TRUNCATE 가 매번 돌므로 전제할 수 있는 것도 없다 |
| T4 | 고정 ID 를 하드코딩하지 않는다 | `RESTART IDENTITY` 로 시퀀스가 1부터라 우연히 통과하는 테스트가 생긴다 |
| T5 | 잔액·재고·순서가 걸린 엔드포인트는 **동시 요청 케이스를 반드시 쓴다** (A7) | 4.5 |
| T6 | 응답은 `packages/shared` 의 zod 스키마로 parse 한다 (C3) | TASK-0107 의 프론트 모킹과 **같은 스키마**여야 드리프트가 잡힌다 |
| T7 | 시각은 주입한다. `new Date()` 를 쓰지 않는다 | 4.7 |

## 5. 구현 계획

1. **CI 에 postgres 서비스 추가** + 이미지 태그 드리프트 검사 스펙. 이 시점의 `pnpm test` 는 아직 그대로다
2. **globalSetup** — 유지보수 커넥션, 마이그레이션 지문, 템플릿 생성(`migrate deploy`), 워커 DB 복제, 진단 메시지
3. **워커 DB 연결과 `useDatabase()`** — `VITEST_POOL_ID` 로 URL 결정, `information_schema` 기반 TRUNCATE
4. **`useApiApp()`** — `listen(0)`, `createApiClient` 연결, 포트 대역 교체 지점, 쿠키 헬퍼
5. **`Clock` 포트**와 고정 시각 대역, `new Date()` 금지 린트 규칙
6. **`concurrently()`** 와 음성 대조군 스펙 (재고 경합)
7. **S5 승격** — 제약 5개를 실 DB 시도로 옮기고 `schema-guards.spec.ts` 에서 파일 기반 제약 단언 제거
8. **`/health` 통합 스펙** — 실 DB 로 `database: ok`, 컨테이너 중지 시 `degraded`. C3 시범
9. 커버리지 프로바이더 설치 + `pnpm test:coverage` (임계값 미설정)
10. 문서 — `README.md` 테스트 절, `.env.example`, 작성 규약(4.9)

## 6. 완료 기준 (Definition of Done)

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | **CI 에서 DB 를 쓰는 테스트가 실제로 실행되고 통과한다** | GitHub Actions `test` job 로그 | `useDatabase()` 를 쓰는 스펙 실행 수 **≥ 8**, 실패 0, **skip 0** | [ ] |
| F2 | **동시성 테스트가 경합을 재현한다** | 재고 1개 · 동시 요청 2건. `stock-contention.spec.ts` 를 20회 반복 | 성공 1 · 실패 1 이 **20/20**, 재고 음수 **0건**, 재고 최종값 0 | [ ] |
| F3 | **하네스가 경합을 실제로 만든다** (음성 대조군) | 같은 스펙의 read-modify-write 대조 케이스 | 대조군에서 초과판매 **재현 20/20** (예약 2건 · 재고 0). 재현되지 않으면 F2 는 무의미하므로 F3 실패 시 F2 불충족 | [ ] |
| F4 | **S5 — 제약이 실 DB 에서 위반을 거부한다** | raw SQL 로 위반 시도 (4.8 표) | 거부 **5/5**, SQLSTATE `23505` 2건 · `23514` 3건, 오류의 제약 이름 일치 5/5 | [ ] |
| F5 | **술어가 정확하다** (조건을 잘못 적은 경우 검출) | 4.8 표의 "허용되어야 하는 것" 8건 시도 | 전부 성공 **8/8** (거부되면 실패) | [ ] |
| F6 | 파일 읽기 우회책 해소 | `apps/api/src/prisma/schema-guards.spec.ts` | 마이그레이션 SQL 문자열을 검사하는 **제약 단언 0건**. 남는 것은 SQL 동반 여부와 S4(부동소수) 검사뿐 | [ ] |
| F7 | **테스트 전체 소요 시간** | 로컬 `pnpm test` (4워커) 3회 중앙값 / CI `test` job / CI 전체 | 로컬 **90초 이하** · CI job **3분 이하** · CI wall clock **5분 이하** | [ ] |
| F8 | **워커 병렬 실행 시 간섭이 없다** | `maxWorkers=4` 로 `pnpm test` **10회 연속** | 실패 0, 순서 의존 실패 0. 실행 후 남은 DB = 템플릿 1 + 워커 4 (그 외 0) | [ ] |
| F9 | 테스트 사이 초기화 | 임의 스펙 시작 시점의 전 테이블 행 수와 시퀀스 | 모든 테이블 **0행**, `RESTART IDENTITY` 로 다음 ID **1** | [ ] |
| F10 | 로컬에서 같은 방식으로 돈다 | 인프라 기동 후 `pnpm test` **한 번** | 추가 명령 **0개**. CI 와 postgres 이미지 태그·DB 이름·실행 경로 동일 | [ ] |
| F11 | 인프라 미기동 시 진단 | postgres 를 내린 상태에서 `pnpm test` | **5초 이내** 종료, exit code ≠ 0, `pnpm infra:up` 을 지시하는 한국어 메시지, **침묵 skip 0건** | [ ] |
| F12 | 이미지 버전 드리프트 방지 | `ci.yml` 과 `docker-compose.yml` 의 postgres 태그 비교 스펙 | 두 값이 다르면 실패. 현재 값 `postgres:17.11-alpine` 일치 | [ ] |
| F13 | 시간 주입 | `apps/api/src/**` 에서 `new Date()` · `Date.now()` 직접 호출 (clock 모듈 제외) | **0건** (`pnpm lint` error 0 으로 확인) | [ ] |
| F14 | 커버리지 리포트 | `pnpm test:coverage` | `apps/api` 라인 커버리지 수치가 출력된다. **임계값은 설정하지 않는다** (M05) | [ ] |
| F15 | 템플릿 복제 비용 | globalSetup 의 워커 DB 생성 구간 계측 로그 | 워커당 **200ms 이하**, 4워커 합계 1초 이하 | [ ] |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:

- **Q5 면제** — M05 부터 적용. 이 TASK 가 만드는 것은 하네스 자체이며, 그 검증은 F1~F15 가 대신한다
- **2장 화면 게이트 해당 없음** — 사용자 대상 화면 없음
- **3장 API 게이트**: 새 엔드포인트를 만들지 않으므로 A1~A5 해당 없음. **A6(실 DB 기반 검증)·A7(동시 요청)은 이 TASK 가 성립시키는 대상**이며, 기존 `GET /api/v1/health` 와 4.5 의 재고 경합 스펙으로 시범 적용한다
- **4장 데이터 게이트**: `schema.prisma` 를 바꾸지 않으므로 S1~S4 해당 없음. **S5 는 이 TASK 가 실제 DB 검증으로 승격**한다 (F4·F5)
- **5장 계약 게이트**: C3(실제 응답을 zod 로 parse)의 **실행 경로를 이 TASK 가 만든다** — 4.4 의 `createApiClient` 채택으로 구조적으로 성립. C1·C2 는 TASK-0107

### 6.3 성능 · 접근성

**해당 없음** — 사용자 화면이 없다. 성능 기준은 F7(테스트 소요 시간)이 대신한다.

### 6.4 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 이 문서의 상태를 `완료` 로 변경하고 인덱스 2곳(`docs/tasks/README.md`, `docs/tasks/M04-auth/README.md`) 갱신 | [ ] |
| D2 | 하네스 API 와 작성 규약(4.9)을 `README.md` 테스트 절에 반영 | [ ] |
| D3 | 새 환경변수가 생기면 `.env.example` 갱신 | [ ] |
| D5 | 도입한 라이브러리 버전을 8장에 기록 | [ ] |

D1 의 인덱스 2곳은 병행 작업 중 충돌을 막기 위해 **오케스트레이터가 별도 커밋으로 갱신**한다 (TASK-0007·0014·0015 와 같은 방식).

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | 이전 실행이 죽으면서 템플릿 DB 에 커넥션이 남아 `CREATE DATABASE ... TEMPLATE` 이 실패 | `DROP DATABASE ... (FORCE)` 로 먼저 정리하고, 실패 시 `pg_terminate_backend` 후 1회 재시도 |
| R2 | `pnpm test` 가 이제 Docker 를 요구한다 — 순수 로직만 고친 사람도 인프라를 띄워야 한다 | F11 의 진단 메시지로 비용을 5초 + 명령 1개로 낮춘다. `test:unit` / `test:integration` 분리는 **폐기** — 두 명령이 되면 누군가는 한쪽만 돌리고, 그때부터 CI 가 유일한 안전망이 된다 |
| R3 | 워커 수가 머신마다 달라 로컬에서 8개, CI 에서 2개가 뜬다 | 워커 수는 `maxWorkers` 하나에서 나오고 DB 는 그 수만큼만 만든다. CI 는 러너 코어 수(2)를 그대로 쓴다 — 어긋나도 격리는 pool ID 로 유지된다 |
| R4 | 마이그레이션이 늘면 템플릿 생성 시간이 선형으로 증가 | 지문 캐시로 로컬 재실행은 0. CI 는 매번 만들지만 `migrate deploy` 는 SQL 재생 뿐이라 마이그레이션 20개에서도 5초 내외. F7 을 넘기면 그때 스키마 덤프 캐시를 검토한다 |
| R5 | GitHub Actions 러너에 다른 postgres 가 5432 를 쓰고 있을 가능성 | `ubuntu-latest` 의 PostgreSQL 은 설치만 되고 기동되지 않는다. 충돌 시 서비스 포트를 옮기고 `PORT_OFFSET` 으로 파생시킨다 (파생 경로가 이미 있다) |
| R6 | 음성 대조군(F3)이 "틀린 코드를 커밋해 두는" 것으로 오해될 수 있음 | 대조군은 프로덕션 경로를 부르지 않고 테스트 안에서 raw SQL 로만 재현한다. 스펙 이름과 주석에 목적을 명시한다 |
| R7 | `pnpm test:coverage` 가 실 DB 를 쓰는 테스트를 포함하므로 커버리지 수집이 느려질 수 있음 | 임계값을 켜지 않는 이번 범위에서는 문제되지 않는다. M05 에서 측정 후 필요하면 별도 job 으로 분리 |

## 8. 확정된 버전

구현 시 채운다.

| 패키지 | 버전 | 용도 |
| --- | --- | --- |
| pg | | 유지보수 커넥션(DB 생성·복제·TRUNCATE). `@prisma/adapter-pg` 의 전이 의존이지만 직접 쓰므로 명시 (dev) |
| @types/pg | | 위의 타입 (dev) |
| @vitest/coverage-v8 | | 커버리지 리포트 (dev) |

- postgres 이미지: `postgres:17.11-alpine` — **새로 고르는 것이 아니라 `docker-compose.yml` 과 같은 값을 쓰는 것**이 요점이다 (F12)

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-03 | 최초 작성. D-207(테스트 레이어와 대역 규약)의 백엔드 절반을 실행 가능하게 만드는 TASK 로 신설 |
