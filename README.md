# shopping

취업 포트폴리오용 이커머스 서비스. 사용자 / 판매자 / 관리자 3개 역할을 지원하며,
방문자는 데모 계정을 즉시 발급받아 전체 기능을 체험할 수 있다.

## 저장소 구조

`bare + worktree` 레이아웃이다. 자세한 내용은 [CLAUDE.md](./CLAUDE.md) 참조.

```
shopping/
├── .bare/
├── main/
└── feature-<name>/
```

## 워크트리와 포트

워크트리를 여러 개 두고 병행 작업하므로 포트가 고정이면 두 번째 워크트리에서 `pnpm dev` 가 실패한다.
모든 포트는 **`PORT_OFFSET` 하나**에서 파생된다. 워크트리마다 `.env.local`(커밋되지 않음)에 오프셋만 적는다.

```bash
# feature-search 워크트리의 .env.local
PORT_OFFSET=10
COMPOSE_PROJECT_NAME=shopping-search
```

| 서비스 | 기본 포트 | `PORT_OFFSET=10` |
| --- | --- | --- |
| shop | 3000 | 3010 |
| seller | 3001 | 3011 |
| admin | 3002 | 3012 |
| api | 4000 | 4010 |
| postgres | 5432 | 5442 |
| storybook | 6006 | 6016 |
| meilisearch | 7700 | 7710 |

```bash
pnpm ports          # 현재 워크트리의 실제 포트 확인
pnpm ports --json   # 스크립트에서 사용
```

`COMPOSE_PROJECT_NAME` 을 워크트리마다 다르게 두지 않으면 두 워크트리가 **같은 DB 컨테이너를 공유**한다.
한쪽에서 마이그레이션을 돌리면 다른 쪽 스키마가 바뀐다.

셸에 직접 지정한 값이 `.env.local` 보다 우선한다 — `PORT_OFFSET=20 pnpm dev` 로 파일 수정 없이 일회성 변경이 가능하다.

## 로컬 인프라

PostgreSQL 과 Meilisearch 를 Docker 로 띄운다. `docker compose` 를 직접 부르지 말고 아래 스크립트를 쓴다 —
스크립트가 이 워크트리의 `.env.local` 을 읽어 **포트(`PORT_OFFSET`)와 프로젝트 이름(`COMPOSE_PROJECT_NAME`)을 자동으로 적용**한다.

### 준비 (워크트리당 한 번)

```bash
cp .env.example .env          # .env 는 커밋되지 않는다
```

**복사한 뒤 고칠 것은 없다.** `DATABASE_URL` · `MEILI_HOST` · `API_PORT` · `CORS_ORIGINS` 는 `.env` 에 없으면
API 가 부팅 시 `PORT_OFFSET` 에서 계산해 채운다. 명시하면 그 값이 그대로 쓰이므로, 로컬 스택이 아닌 곳
(Neon, 원격 검색 서버)을 가리킬 때만 주석을 풀면 된다. 실제 포트는 `pnpm ports` 로 확인할 수 있다.

### 명령

| 명령 | 하는 일 |
| --- | --- |
| `pnpm infra:up` | 백그라운드 기동 후 **두 컨테이너가 healthy 가 될 때까지 대기** |
| `pnpm infra:down` | 컨테이너 중지·제거. **볼륨은 남으므로 데이터는 보존된다** |
| `pnpm infra:reset` | 볼륨까지 삭제하고 재기동. **DB 데이터가 사라진다** |
| `pnpm infra:logs` | 두 컨테이너 로그 (기본 `--follow --tail 100`) |
| `pnpm infra:ps` | 기동 상태·헬스체크 확인 |

뒤에 붙인 인자는 `docker compose` 로 그대로 전달된다 — `pnpm infra:logs postgres --tail 20`.

```bash
pnpm infra:up
pnpm infra:ps        # 두 서비스 모두 (healthy) 여야 한다
```

### 서비스

| 서비스 | 이미지 | 호스트 포트 | 볼륨 |
| --- | --- | --- | --- |
| postgres | `postgres:17.11-alpine` | 5432 + `PORT_OFFSET` | `<project>_pgdata` |
| meilisearch | `getmeili/meilisearch:v1.24.0` | 7700 + `PORT_OFFSET` | `<project>_meilidata` |

- WSL2 에서 바인드 마운트는 느리고 권한 문제가 잦아 **named volume** 만 쓴다.
- 볼륨·컨테이너·네트워크 이름은 전부 `COMPOSE_PROJECT_NAME` 으로 시작하므로 워크트리끼리 섞이지 않는다.
- Meilisearch 는 `MEILI_MASTER_KEY` 로 보호된다. 키 없이 호출하면 401 이다.

```bash
curl -H "Authorization: Bearer $MEILI_MASTER_KEY" "$MEILI_HOST/health"   # {"status":"available"}
```

## API

```bash
pnpm --filter @shopping/api dev     # 4000 + PORT_OFFSET 에서 기동
curl localhost:4000/api/v1/health   # {"status":"ok","search":"ok","uptime":3,"version":"0.0.0"}
```

| 항목 | 값 |
| --- | --- |
| 프레임워크 | NestJS 12 (Express) |
| 프리픽스 | `/api/v1` — 버전은 URI 방식, 라우트가 생략하면 `v1` |
| 헬스체크 | `GET /api/v1/health` → `{ status, search, uptime, version }` |
| 에러 포맷 | `{ "error": { "code", "message", "details": [] } }` — 성공 응답은 감싸지 않는다 |
| CORS | `CORS_ORIGINS` 의 오리진만 허용. 기본값은 shop·seller·admin 세 앱 |
| 로그 | 모든 요청에 `X-Request-Id` 부여 후 `메서드 경로 상태 소요시간 요청ID` 로 기록 |

- 환경변수는 **부팅 시점에 zod 로 검증**한다. 누락·형식 오류면 변수명을 출력하고 종료 코드 1 로 끝난다.
  값은 절대 출력하지 않는다.
- 검색 엔진이 죽어도 헬스체크는 **200 을 유지**하고 `search: "down"`, `status: "degraded"` 를 반환한다.
  API 자체는 살아 있으므로 로드밸런서가 인스턴스를 빼면 안 된다.
- 스택 트레이스는 `NODE_ENV=development` 에서 5xx 응답에만 들어간다.

```bash
pnpm --filter @shopping/api build   # dist/ 로 컴파일
pnpm --filter @shopping/api start   # 컴파일된 결과 실행
pnpm --filter @shopping/api test    # vitest (Postgres 필요 — "테스트" 절 참조)
```

## 데이터베이스

Prisma 명령은 저장소 루트에서 실행한다. `DATABASE_URL` 은 이 워크트리의 `PORT_OFFSET` 에서
파생되므로 따로 설정할 것이 없다. 먼저 `pnpm infra:up` 으로 Postgres 가 떠 있어야 한다.

| 명령 | 설명 |
| --- | --- |
| `pnpm db:migrate` | 스키마 변경을 마이그레이션으로 만들고 적용 (개발) |
| `pnpm db:deploy` | 이미 만들어진 마이그레이션만 적용 (배포) |
| `pnpm db:status` | 적용 상태 확인 |
| `pnpm db:reset` | DB 를 비우고 처음부터 재적용 — **데이터가 사라진다** |
| `pnpm db:seed` | 시드 실행 (내용은 M05 부터) |
| `pnpm db:studio` | Prisma Studio. 포트는 `5555 + PORT_OFFSET` |
| `pnpm db:generate` | Prisma Client 재생성 (`pnpm install` 이 자동으로 한다) |

`db:reset` 은 확인 프롬프트를 띄운다. 비대화형 셸에서는 `pnpm db:reset --force`.
마이그레이션 SQL 은 커밋한다. 배포 환경에서는 `db:deploy` 만 돈다.

## 테스트

`pnpm test` 하나로 로컬과 CI 가 **같은 방식**으로 돈다. 로컬에서는 `pnpm infra:up` 이 선행이다.

```bash
pnpm infra:up          # Postgres 가 떠 있어야 한다
pnpm test              # 워크스페이스 전체
pnpm test:coverage     # 커버리지 리포트 + 임계값 (M05 부터 적용)
```

**백엔드 테스트는 실제 PostgreSQL 에 대해 돈다.** 이 프로젝트는 불변식을 DB 가 강제하도록
설계했으므로(부분 유니크 인덱스·CHECK·조건부 재고 갱신·행 잠금), Prisma 를 모킹하면 정확히
그 부분만 검증에서 빠진다. 근거는 [D-207](./docs/decisions/2026-09-03-session-02.md),
규약은 [QUALITY-GATES 6장](./docs/tasks/QUALITY-GATES.md#6-테스트-대역-규약).

Postgres 가 없으면 **건너뛰지 않고 실패한다.** 5초 안에 원인과 `pnpm infra:up` 을 안내한다 —
아무것도 검증하지 않은 초록이 가장 나쁜 결과이기 때문이다.

### 격리 방식

| 경계 | 방법 |
| --- | --- |
| 워커 사이 | **워커별 데이터베이스.** `shopping_test_tpl` 에 마이그레이션을 1회 적용하고 `CREATE DATABASE ... TEMPLATE` 로 `shopping_test_w1..4` 를 복제 |
| 테스트 사이 | **`TRUNCATE ... RESTART IDENTITY CASCADE`.** 대상 테이블은 `information_schema` 에서 조회하므로 스키마가 늘어도 손댈 곳이 없다 |

**테스트를 트랜잭션으로 감싸 롤백하지 않는다.** 커밋되지 않은 행은 다른 커넥션에서 보이지
않아 동시 요청 상황 자체를 만들 수 없고, 프로덕션 코드의 트랜잭션이 savepoint 로 강등된다.
전부 진짜 커밋이므로 잠금·격리 수준이 프로덕션과 같은 의미로 동작한다.

두 번째 실행부터는 마이그레이션 지문이 같으면 템플릿과 워커 DB 를 **그대로 재사용**한다
(`DROP DATABASE` 는 체크포인트를 강제해서 1~2초가 든다). 손으로 건드려 이상해졌다면
`TEST_DB_REBUILD=1 pnpm test` 로 전부 다시 만든다.

### 하네스

```ts
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'

const db = useDatabase()                     // 워커 DB 연결 + beforeEach TRUNCATE
const api = useApiApp({ database: db })      // listen(0) + createApiClient

it('...', async () => {
  const health = await api.client.getHealth()   // zod 로 parse 된 응답 (게이트 C3)
  expect(health.database).toBe('ok')
})
```

| 조각 | 위치 | 하는 일 |
| --- | --- | --- |
| `useDatabase()` | `apps/api/test/support/database.ts` | 워커 DB 풀, `query` · `one` · `execute` · `withConnection`, 테스트마다 TRUNCATE |
| `useApiApp()` | `apps/api/test/support/api-app.ts` | `main.ts` 와 **같은** `configureApp` 으로 앱을 띄우고 실제 소켓에 바인딩. `client` 는 프론트가 쓰는 `createApiClient` |
| `useApiApp({ authenticate: true })` · `api.clientAs(caller)` | `apps/api/test/support/principal.ts` | 헤더로 호출자를 지정한다. 인증이 아직 없어(TASK-0021·0022) 이것 없이는 모든 보호 엔드포인트가 401 이라 **게이트 A3(403)을 관측할 수 없다** |
| `useApiApp({ prisma })` | `apps/api/test/support/api-app.ts` | 앱이 쓸 Prisma 클라이언트를 교체한다. 용도는 **쿼리 로깅 하나** — 게이트 A5(N+1 없음)를 코드 읽기가 아니라 **문장 수 측정**으로 확인한다. 모킹이 아니라 같은 클래스·같은 워커 DB 다 |
| `concurrently(n, fn)` · `barrier(n)` | `apps/api/test/support/concurrently.ts` | 동시 호출과 결정적 인터리빙 |
| `fixedClock(iso)` | `apps/api/test/support/clock.ts` | `CLOCK` 포트에 바인딩되는 고정 시각 |
| `createUser` · `createAddress` · … | `apps/api/test/support/factories.ts` | 픽스처 팩토리 |
| 쿠키 | `api.cookies` | `Set-Cookie` 를 저장했다가 다음 요청에 실어 보낸다. `HttpOnly`·`SameSite`·`Path`·`Max-Age` 를 단언할 수 있다 |

HTTP 를 **실제로** 부른다(`listen(0)`). 인프로세스 호출이 빠르지만 동시 요청이 진짜 동시가
되지 않고, 쿠키·CORS·헤더가 검증 범위에서 빠진다.

### 작성 규약

| # | 규칙 | 이유 |
| --- | --- | --- |
| T1 | Prisma·리포지토리를 **모킹하지 않는다** | 모킹하는 순간 DB 가 강제하는 불변식이 검증에서 빠진다 |
| T2 | 픽스처는 **팩토리 함수**로 만든다 | 스키마가 늘 때 한 곳만 고친다 |
| T3 | 다른 테스트가 남긴 데이터를 전제하지 않는다 | TRUNCATE 가 매번 돈다 |
| T4 | 고정 ID 를 하드코딩하지 않는다 | `RESTART IDENTITY` 때문에 우연히 통과하는 테스트가 생긴다 |
| T5 | 잔액·재고·순서·멱등이 걸린 경로는 **동시 요청 케이스를 반드시 쓴다** | 게이트 A7 |
| T6 | 응답은 `packages/shared` 의 zod 스키마로 parse 한다 | 게이트 C3. 프론트 모킹과 같은 스키마여야 드리프트가 잡힌다 |
| T7 | 시각은 주입한다. `new Date()` · `Date.now()` 를 쓰지 않는다 | 아래 |

**동시 요청 테스트에는 음성 대조군을 붙인다.** "하나만 성공했다"는 단언은 두 요청이 실제로는
겹치지 않아도 통과한다. 일부러 틀린 구현(read-then-write)이 **반드시 초과판매를 재현**하는
것을 함께 보여야 앞의 단언이 구현에 대한 증거가 된다. 본보기는
`apps/api/test/db/stock-contention.spec.ts`.

**불변식을 DB 가 강제하면 대조군은 두 겹이 된다.** 카테고리 트리처럼 제약이 손상 자체를
불가능하게 만든 경우, 락 없는 구현을 실제 테이블에 돌려도 DB 가 먼저 거부하므로 "트리가
깨지는 모습"을 볼 수 없다. 그래서 `apps/api/test/db/category-tree-contention.spec.ts` 는
① 락 없는 구현을 **실 테이블**에 돌려 *성공했다고 답하지만 아무것도 옮기지 않는* 사일런트
오답을 재현하고, ② 같은 인터리빙을 제약이 없는 픽스처 테이블(`TestCategoryNaive`)에 돌려
**순환 참조와 끊어진 경로 캐시**를 실제로 만들어 보인다. 두 번째가 없으면 제약이 무엇을
막고 있는지 아무도 확인하지 않은 채로 남는다.

### 시각 주입

만료·정산 마감처럼 시각에 의존하는 로직은 현재 시각을 **인자 또는 `Clock` 포트로 받는다**.
`apps/api/src/**` 에서 `new Date()` · `Date.now()` 직접 호출은 **린트가 막는다**
(`apps/api/eslint.config.mjs`). 예외는 포트 구현체인 `src/common/clock.ts` 한 곳뿐이다.

`vi.setSystemTime` 으로 대신하지 않는다 — **DB 의 `now()` 는 따라오지 않아서** `DEFAULT now()`
컬럼과 애플리케이션 시각이 어긋나고, 만료 판정이 테스트에서만 맞는다.

### 대역 규약

| 대상 | 대역 |
| --- | --- |
| PostgreSQL · 가상 카드 | **실제** |
| Meilisearch · 토스페이먼츠 · Google OAuth · Cloudflare R2 | 모킹 |
| 시간 | 주입 (`Clock`) |

## 웹 앱 (shop / seller / admin)

구매자·판매자·관리자를 **독립된 Next.js 앱 3개**로 띄운다. 세션도 앱별로 독립이다(쿠키에 `Domain` 미지정).

```bash
pnpm dev                              # API + 웹 3개를 한 번에 (아래 표의 포트)
pnpm --filter @shopping/shop dev      # 필요한 앱만 따로
pnpm --filter @shopping/seller dev
pnpm --filter @shopping/admin dev
```

| 앱 | 패키지 | 포트 | 대상 |
| --- | --- | --- | --- |
| `apps/shop` | `@shopping/shop` | 3000 + `PORT_OFFSET` | 구매자 |
| `apps/seller` | `@shopping/seller` | 3001 + `PORT_OFFSET` | 판매자 |
| `apps/admin` | `@shopping/admin` | 3002 + `PORT_OFFSET` | 관리자 |

앱 3개를 동시에 띄우면 개발 머신이 버거울 수 있다. **`--filter` 로 필요한 앱만 띄우는 쪽이 기본**이고,
`pnpm dev` 는 네 프로세스를 한 번에 확인할 때 쓴다. 한 앱을 Ctrl+C 로 멈춰도 나머지는 계속 돈다.

각 앱의 `dev` / `build` / `start` 는 `scripts/web-app.mjs` 를 거친다. Next 는 설정 파일을 읽기 전에
포트를 정하므로 `next.config.ts` 에서는 늦다. 이 래퍼가 `scripts/ports.mjs` 에서 두 값을 계산해 넘긴다.

| 변수 | 파생 규칙 |
| --- | --- |
| `PORT` | 앱별 기본 포트 + `PORT_OFFSET` |
| `NEXT_PUBLIC_API_URL` | `http://localhost:(4000 + PORT_OFFSET)` |

셸에 이미 있는 값이 이긴다 — 배포 플랫폼이 주입한 `PORT` 가 그대로 쓰이고,
`PORT_OFFSET=10 pnpm dev` 는 파일 수정 없이 3010·3011·3012·4010 으로 옮겨 준다.

> `NEXT_PUBLIC_*` 은 **빌드 시점에 페이지에 박힌다.** 비밀값을 넣으면 안 되고,
> `PORT_OFFSET` 을 바꾼 뒤 `pnpm start` 로 확인하려면 다시 빌드해야 한다. `pnpm dev` 는 재시작만 하면 된다.

### 구조

```
apps/shop/
├── src/
│   ├── app/          App Router — layout.tsx / page.tsx / globals.css
│   ├── components/   이 앱 전용 컴포넌트
│   ├── lib/          api.ts (이 앱의 API 클라이언트) · health.ts
│   └── messages/     UI 문구. ko.ts 가 유일한 카탈로그이고 컴포넌트는 types.ts 만 본다
├── test/             스펙 + setup.ts (모킹 서버). 아래 "테스트" 절 참조
└── vitest.config.mjs @shopping/config 의 프리셋 한 줄
```

- **API 클라이언트는 `packages/shared/src/api` 하나뿐이다.** 각 앱은 자기 `AppId` 로 인스턴스만 만든다.
  모든 요청에 `X-App-Id` 가 실리므로, 쿠키를 공유하지 않는 세 앱을 API 가 구분할 수 있다.
- **UI 문구는 하드코딩하지 않는다.** 한국어 카탈로그(`messages/ko.ts`)만 있고 다국어는 구조만 잡혀 있다.
- Tailwind 는 v4(CSS 우선 설정)다. 공통 프리셋 `@shopping/config/tailwind/preset.css` 를 세 앱이 확장한다.
  디자인 토큰과 밀도 3단계는 M03 에 이 프리셋으로 들어온다.
- 루트 페이지는 **기동 확인용 임시 화면**이다. `/health` 응답에 들어 있는 상태 항목을 그대로 그리므로
  API 에 항목이 늘면 화면도 따라 늘어난다. M03 에서 실제 화면으로 교체된다.

```bash
pnpm --filter @shopping/shop build    # .next 로 프로덕션 빌드
pnpm --filter @shopping/shop start    # 빌드 결과 실행
```

## 디자인 시스템 (Storybook)

`packages/ui` 의 컴포넌트와 **디자인 토큰 문서**를 한곳에서 본다. 앱을 띄우지 않고 확인할 수 있고,
툴바에서 **밀도 3단계를 바꾸면 모든 스토리가 즉시 반영**된다 — 이 프로젝트에서 Storybook 을 쓰는 이유다.

```bash
pnpm storybook         # 6006 + PORT_OFFSET 에서 기동
pnpm storybook:build   # packages/ui/storybook-static 으로 정적 빌드
```

| 사이드바 | 담는 것 |
| --- | --- |
| **Design tokens / Colour** | 시맨틱·팔레트 토큰 전체, 각 값과 `--color-surface` 대비비, 이름에서 유도한 대비 쌍 |
| **Design tokens / Typography** | 폰트 스택, 타입 스케일(선택한 밀도에서 실제 렌더된 px), tracking·leading |
| **Design tokens / Spacing** | `--spacing` 배수, radius, shadow |
| **Design tokens / Density** | **밀도 3 × 뷰포트 3 매트릭스**, 컨트롤 높이와 44px 터치 하한, 3단계 나란히 비교 |
| **Components / \*** | 기본 컴포넌트 20종 — 기본 · 전체 variant · 상태 · 엣지 케이스 |

**토큰 문서의 값은 어디에도 적혀 있지 않다.** 토큰 이름은 `document.styleSheets` 를 훑어 찾고,
값은 `getComputedStyle` 로 읽고, 길이는 브라우저가 배치한 박스를 재서 얻는다. 매트릭스의 나머지 여섯 칸은
해당 폭으로 만든 화면 밖 `<iframe>` 안에서 잰다 — 미디어 쿼리는 뷰포트에만 답하기 때문이다.
문서에 숫자를 옮겨 적으면 반드시 어긋나고, 어긋난 순간 이 문서는 믿을 수 없어진다(D-206).

접근성은 화면에 표시만 하지 않는다. **모든 스토리에 axe 를 돌리는 검사가 `pnpm test` 안에 있고**
(`packages/ui/test/story-a11y.spec.tsx`), 위반이 하나라도 있으면 CI 의 `test` 잡이 빨개진다.
규칙 집합은 애드온과 이 검사가 `packages/ui/stories/support/a11y.ts` 하나를 공유한다.

> 스토리는 `packages/ui/stories/` 에 둔다. `packages/ui/src` 는 Tailwind 가 스캔하는 트리라서
> 거기에 두면 **스토리 전용 클래스가 앱 3개의 CSS 에 섞여 들어간다.**

## 환경변수

| 파일 | 커밋 | 담는 것 |
| --- | --- | --- |
| `.env.example` | O | 전 변수 목록과 로컬 기본값. **템플릿이며 실제 비밀값을 넣지 않는다** |
| `.env` | X | 이 머신의 실제 로컬 값. `docker compose` 와 앱이 함께 쓴다 |
| `.env.local` | X | **워크트리별 값만** — `PORT_OFFSET`, `COMPOSE_PROJECT_NAME` |

우선순위는 **셸 > `.env.local` > `.env`** 다. 셸 값이 항상 이기므로 파일을 고치지 않고 일회성으로 바꿀 수 있다.

```bash
PORT_OFFSET=40 COMPOSE_PROJECT_NAME=shopping-tmp pnpm infra:up   # 완전히 독립된 두 번째 스택
```

새 환경변수를 추가하면 **`.env.example` 에도 반드시 추가한다.** 비밀값은 커밋하지 않는다.

### 포트가 들어가는 값은 적지 않는다

아래 네 개는 `.env` 에 **없을 때** API 가 `PORT_OFFSET` 에서 계산한다. 워크트리마다 손으로 고칠 것이 없다는 뜻이다.

| 변수 | 파생 규칙 |
| --- | --- |
| `API_PORT` | `4000 + PORT_OFFSET`. 없으면 `PORT`(Render·Railway 가 주입) 를 먼저 본다 |
| `MEILI_HOST` | `http://localhost:(7700 + PORT_OFFSET)` |
| `DATABASE_URL` | `postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:(5432 + PORT_OFFSET)/$POSTGRES_DB` |
| `CORS_ORIGINS` | shop·seller·admin 오리진 (`localhost` 와 `127.0.0.1` 양쪽) |

웹 앱 3개의 `PORT` 와 `NEXT_PUBLIC_API_URL` 도 같은 방식으로 `scripts/web-app.mjs` 가 채운다.

`scripts/ports.mjs` 가 단일 출처이며, API 는 이 파일을 런타임에 읽는다. 기본 포트를 바꿀 일이 생기면 그 파일만 고치면 된다.

```bash
PORT_OFFSET=50 pnpm --filter @shopping/api dev   # 파일 수정 없이 4050 에서 기동
```

**명시한 값이 항상 이긴다.** 워크스페이스도 `.env` 도 없는 곳(컨테이너에 `dist/` 만 실은 경우)에서는
파생이 아예 동작하지 않으므로 플랫폼이 전부 주입해야 한다.

> **배포 환경이라고 파생이 꺼지는 것은 아니다.** Render 의 Node 런타임은 **저장소 체크아웃 위에서**
> 빌드하고 실행하므로 `pnpm-workspace.yaml` 과 `scripts/ports.mjs` 가 그대로 있고, 따라서 파생이
> 동작한다(`PORT_OFFSET` 이 없으니 오프셋 0). 그래서 `DATABASE_URL` · `MEILI_HOST` · `CORS_ORIGINS`
> 를 빠뜨리면 **부팅이 거부되는 것이 아니라 조용히 localhost 기본값**이 된다.
> `MEILI_MASTER_KEY` 만 파생 대상이 아니라서 빠지면 이름과 함께 보고되고 종료한다.
> `render.yaml` 이 네 값을 전부 명시하는 이유다.

## 개발 워크플로

### 품질 게이트

| 명령 | 검사 |
| --- | --- |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | eslint — **루트 파일 먼저, 그 다음 패키지 7개** |
| `pnpm format:check` | prettier — 루트에서 한 번에 저장소 전체 |
| `pnpm build` | 전 패키지 빌드 |
| `pnpm test` | vitest |

`pnpm -r` 은 **루트 프로젝트를 건너뛴다.** 그래서 `scripts/*.mjs` 와 루트 설정 파일은
패키지 스크립트로는 영원히 검사되지 않는다. lint 는 루트 검사(`pnpm lint:root`)를 먼저
돌리고, format 은 아예 루트 한 번으로 저장소 전체를 본다.

마크다운은 prettier 대상에서 뺐다(`.prettierignore`). 표를 CJK 폭 기준으로 다시 정렬하고
문서 안의 코드 예제까지 다시 쓰기 때문에, 포맷이 아니라 문서 수정이 되어 버린다.

`typecheck` · `lint` · `test` 는 **`packages/shared/dist` 가 있어야** 통과한다.
`pnpm install` 이 그 패키지의 `prepare` 훅으로 만들어 주지만, 지웠다면 다시 만든다.

```bash
pnpm --filter @shopping/shared build
```

### 테스트

| 패키지 | 러너 | 환경 | 대상 |
| --- | --- | --- | --- |
| `apps/shop` · `apps/seller` · `apps/admin` | vitest | jsdom | 화면. **API 는 모킹한다** |
| `packages/ui` | vitest | jsdom | 컴포넌트 · 토큰 규칙 |
| `packages/api-mocks` | vitest | node | 모킹 픽스처가 계약(zod 스키마)을 지키는지 |
| `apps/api` | vitest | node | 서비스 · 가드 · 설정 |

무엇을 실제로 쓰고 무엇을 대역으로 바꾸는지는
[`docs/tasks/QUALITY-GATES.md`](./docs/tasks/QUALITY-GATES.md) 6장이 정한다.

#### 프론트 테스트는 실 API 를 부르지 않는다

세 앱의 테스트는 `@shopping/api-mocks` 가 띄우는 **MSW 서버**에 대고 돈다.
`setupTestServer()` 한 번이 모킹 서버 · 미처리 요청 검사 · 아웃바운드 소켓 검사를 모두 건다.

```ts
// apps/<app>/test/setup.ts — 세 앱이 같은 파일이다
export const testServer = setupTestServer()
```

빠져나갈 구멍을 세 겹으로 막는다.

1. `onUnhandledRequest: 'error'` — 핸들러가 없는 요청은 통과가 아니라 **즉시 실패**
2. 테스트의 `NEXT_PUBLIC_API_URL` 은 `http://api.test.invalid` — `.invalid` 는 RFC 6761
   예약 TLD 라 **절대 resolve 되지 않는다.** 로컬 API 를 우연히 때리는 일이 불가능하다
3. `net.Socket.prototype.connect` 카운터 — 스펙 파일이 끝날 때 실제로 열린 TCP 연결이
   하나라도 있으면 **연결 대상을 이름과 함께 출력하며 실패**시킨다

#### Server Component 테스트

async Server Component 는 그냥 async 함수다. Next 런타임 없이 부르고, 반환된 트리를 그린다.
그 사이의 `fetch` 는 MSW 가 가로챈다.

```tsx
render(await HomePage())
expect(screen.getByText(healthOk.version)).toBeVisible()
```

#### 응답을 바꿔 보고 싶을 때

기본 핸들러는 언제나 "정상 응답"이다. 이상 상황은 그것을 원하는 스펙이 **직접 선언**한다.

```ts
testServer.server.use(networkFailure(mockPaths.health))   // API 가 죽었다
testServer.server.use(httpFailure(mockPaths.health, 500, 'INTERNAL_ERROR', '...'))
testServer.server.use(malformedResponse(mockPaths.health, driftedHealthPayload))
```

#### 엔드포인트를 하나 추가하려면

**`packages/api-mocks` 안에서만** 끝난다. 앱 3개를 돌아다니지 않는다.

1. `src/paths.ts` 에 경로 패턴 추가 — 호스트는 `*` 로 둔다(앱마다 API URL 이 다르다)
2. `src/fixtures/<name>.ts` — **반드시 `defineFixture(스키마, 값)`** 로 만든다.
   평범한 객체 리터럴은 `registry.spec.ts` 가 잡는다
3. `src/fixtures/index.ts` 에 re-export
4. `src/handlers/<name>.ts` 에 핸들러, `src/handlers/index.ts` 의 `defaultHandlers` 에 추가

픽스처는 **`packages/shared` 의 zod 스키마를 통과해야 한다**(계약 게이트 C2). `defineFixture`
는 모듈 로드 시점에 `parse` 하므로, 어긋난 픽스처는 그것을 import 하는 모든 스펙을 무너뜨린다.
같은 스키마를 백엔드 통합 테스트가 실제 응답에 적용한다(C3) — 그래서 스키마 · 백엔드 · 모킹
셋 중 둘이 어긋나면 정해진 스펙이 반드시 빨개진다.

### 커밋 훅

| 훅 | 하는 일 | 도구 |
| --- | --- | --- |
| `pre-commit` | 스테이징된 파일만 `eslint --fix` → `prettier --write` | lint-staged |
| `commit-msg` | Conventional Commits 형식 검증 | commitlint |

- 훅은 **변경된 파일만** 본다. 저장소가 커져도 커밋이 느려지지 않는다. 전체 검사는 CI 몫이다.
- 포맷이 어긋난 파일은 훅이 **고쳐서 다시 스테이징**하므로 그대로 커밋된다.
  자동으로 못 고치는 린트 오류(미사용 변수 등)는 파일·줄 번호를 출력하고 커밋을 중단한다.
- 훅은 `pnpm install` 이 설치한다(루트 `prepare: husky`). **새 워크트리를 만들면
  `pnpm install` 을 한 번 돌려야** 훅이 붙는다.

### 커밋 메시지

[Conventional Commits](https://www.conventionalcommits.org/). 타입은 8개만 허용한다 —
`feat` `fix` `docs` `chore` `refactor` `test` `style` `perf` (CLAUDE.md 3장과 동일).
`ci` · `build` · `revert` 는 쓰지 않는다. CI 작업도 `chore` 다.

```
chore(ci): PR 에서 typecheck · lint · build · test 병렬 실행

본문은 한국어로, 무엇을 왜 바꿨는지 적는다.
```

### 훅 우회

```bash
git commit --no-verify -m "..."    # 이 커밋만
HUSKY=0 git commit -m "..."        # 이 커밋만 (환경변수 방식)
HUSKY=0 git rebase -i main         # 커밋을 여러 개 다시 쓰는 명령 전체
```

rebase·cherry-pick 은 커밋마다 훅을 돌리므로 `HUSKY=0` 쪽이 편하다.
우회하더라도 **PR 에서 같은 검사가 다시 돈다.** 결국 고쳐야 하므로, 우회는 중간 커밋을
정리하는 동안만 쓴다.

### CI

PR 을 올리면 `.github/workflows/ci.yml` 이 4개 job 을 **병렬로** 돌린다.

| job | 명령 |
| --- | --- |
| `typecheck` | `pnpm typecheck` |
| `lint` | `pnpm lint` + `pnpm format:check` |
| `build` | `pnpm build` |
| `test` | `pnpm test` — **postgres 서비스 컨테이너와 함께** |

- 네 job 은 서로 의존하지 않는다. 각 job 이 `.github/actions/setup` 으로
  **install → `packages/shared` 빌드**까지 스스로 마친 뒤 자기 명령을 돌린다.
  빌드 산출물을 job 사이에 공유하려면 앞단에 build job 을 하나 둬야 하는데,
  그러면 병렬 이득이 사라진다.
- pnpm store 는 `actions/setup-node` 의 `cache: pnpm` 이 `pnpm-lock.yaml` 해시를
  키로 캐시한다. 잠금 파일이 그대로면 두 번째 실행부터 패키지를 내려받지 않는다.
- `test` job 에만 **`postgres:17.11-alpine` 서비스 컨테이너**가 붙는다. 이미지 태그는
  `docker-compose.yml` 과 같아야 하며, 워크플로가 그 파일을 읽을 수 없으므로
  `apps/api/test/ci/postgres-image-parity.spec.ts` 가 두 문자열을 비교한다.
  마이그레이션 단계는 없다 — 테스트의 globalSetup 이 템플릿 DB 를 만들면서 적용한다.
CI 는 **PR 과 `main` push 양쪽**에서 돈다. rebase 머지는 커밋을 다시 쓰므로 PR 이 검사한
SHA 와 `main` 에 올라간 SHA 가 다르다. 그래서 `main` 에서도 한 번 더 돈다.

### 브랜치 보호

`main` 은 **보호된 브랜치다. 직접 push 할 수 없다**(관리자 포함).

```bash
git rebase main && git push -u origin feature/<name>
gh pr create --fill
gh pr checks --watch
gh pr merge --rebase --delete-branch
```

머지는 **rebase 만** 허용된다(squash·merge commit 은 껐다). 4개 job 이 green 이어야
머지 버튼이 열리고, PR 브랜치는 `main` 기준 최신이어야 한다.
자세한 내용은 [`docs/branch-protection.md`](./docs/branch-protection.md).

## 배포

> **현재 상태: 아직 배포되어 있지 않다.** `render.yaml` 은 저장소에 들어왔지만
> Render 서비스가 아직 만들어지지 않았다. 소유자가 해야 할 클릭은
> [`docs/OWNER-CHECKLIST.md`](./docs/OWNER-CHECKLIST.md) 에, 남은 항목은
> [TASK-0009](./docs/tasks/M02-deployment/TASK-0009-backend-deploy.md) 6.1 표에 있다.

| 대상 | 어디에 | 정의된 곳 |
| --- | --- | --- |
| API (NestJS) | Render 무료 web `shopping-api` | `render.yaml` |
| 검색 (Meilisearch) | Render 무료 web `shopping-search` | `render.yaml` |
| PostgreSQL | **Neon** 무료 | Render 밖. `DATABASE_URL` 로만 연결 |
| 웹 앱 3개 | Vercel | TASK-0010 |

### 설정은 대시보드가 아니라 `render.yaml` 에 있다

Render 는 저장소 루트의 `render.yaml`(Blueprint)을 읽어 서비스를 만들고 갱신한다.
**대시보드에서 바꾼 값은 다음 sync 때 파일 값으로 덮인다.** 설정을 바꾸려면 파일을
고쳐 커밋하고, Render 대시보드의 Blueprint 에서 sync 한다.

예외는 `sync: false` 로 선언한 세 개(`DATABASE_URL` · `MEILI_MASTER_KEY` ·
`MEILI_HOST`)뿐이다. 이 값들은 파일에 담을 수 없어 대시보드에만 있고, Blueprint 를
다시 sync 해도 덮이지 않는다.

파일이 스키마에 맞는지 확인:

```bash
# 편집기(YAML 확장)는 파일 첫 줄의 $schema 주석으로 자동 검증한다.
# CLI 로 확인하려면 Render 가 공개하는 공식 스키마로 검증한다.
curl -sSL https://render.com/schema/render.yaml.json -o /tmp/render.schema.json
npx --yes ajv-cli@5 validate --spec=draft2020 -s /tmp/render.schema.json \
  -d <(npx --no-install js-yaml render.yaml)
```

### 빌드와 시작

```
빌드: pnpm install --frozen-lockfile --prod=false && pnpm --filter @shopping/api build
시작: pnpm --filter @shopping/api db:deploy && node apps/api/dist/main.js
```

- **`--prod=false` 를 지우지 않는다.** `NODE_ENV=production` 은 빌드에도 적용되고,
  그러면 pnpm 이 devDependencies 를 설치하지 않는다. `nest`(빌드)와
  `prisma`(마이그레이션) CLI 가 둘 다 devDependency 라 빌드도 시작도 깨진다.
- **마이그레이션이 시작 명령에 있다.** Render 의 `preDeployCommand` 는 유료 전용이다.
  `migrate deploy` 는 멱등이라 매 기동마다 돌아도 안전하고, 적용할 것이 없으면
  아무 일도 하지 않는다.
- 포트는 Render 가 주입하는 `PORT`(기본 10000)를 API 가 폴백으로 읽는다.
- Node 버전은 `.nvmrc` 가 단일 출처다. Render 가 그 파일을 읽는다.

### 처음 배포하기

`render.yaml` 이 `main` 에 있어야 한다.

1. Render 대시보드 → **New → Blueprint** → `demo-shopping` 저장소 선택 → 브랜치 `main`
2. Render 가 비밀값 3개를 묻는다. 아래 값을 넣는다.

   | 서비스 | 변수 | 값 |
   | --- | --- | --- |
   | `shopping-api` | `DATABASE_URL` | Neon 콘솔의 연결 문자열 (`?sslmode=require` 포함) |
   | `shopping-api` | `MEILI_MASTER_KEY` | `openssl rand -base64 32` 로 새로 생성 |
   | `shopping-api` | `MEILI_HOST` | 아직 모른다. `https://REPLACE-ME.onrender.com` 을 넣고 4번에서 고친다 |
   | `shopping-search` | `MEILI_MASTER_KEY` | **위와 같은 값** |

3. **Deploy Blueprint.** 서비스 2개가 만들어진다.
4. `shopping-search` 서비스의 URL(`https://shopping-search-xxxx.onrender.com`)을 복사해
   `shopping-api` 의 `MEILI_HOST` 에 넣고 저장한다. API 가 자동으로 재배포된다.
5. 확인:

   ```bash
   curl https://shopping-api-xxxx.onrender.com/api/v1/health
   # {"status":"ok","database":"ok","search":"ok","uptime":..,"version":".."}
   ```

`MEILI_HOST` 를 2단계로 넣는 이유는 서비스 URL 이 생성 전에는 존재하지 않기 때문이다.
`fromService` 로 받을 수 없다 — 그 필드가 주는 것은 사설망 호스트명인데, **무료 web
서비스는 사설망 요청을 받지 못한다.**

### 설정을 바꾸기 (평상시)

```bash
# 1. render.yaml 을 고치고 PR 로 main 에 머지한다
# 2. Render 대시보드 → Blueprints → 해당 Blueprint → Sync
```

코드만 바뀐 경우에는 아무것도 하지 않아도 된다. `autoDeployTrigger: commit` 이라
`main` 에 push 되면 자동 배포된다. 단 `buildFilter.paths` 에 걸리는 경로가 바뀌었을
때만 트리거된다(웹 앱이나 문서만 고치면 API 는 재배포되지 않는다).

### 롤백

| 상황 | 방법 |
| --- | --- |
| **코드가 문제** | Render 대시보드 → 서비스 → **Deploys** 탭 → 직전 성공 배포의 **Rollback**. 즉시 그 커밋의 빌드 결과로 되돌아간다 |
| **설정(`render.yaml`)이 문제** | `main` 에서 해당 커밋을 `git revert` → 머지 → Blueprint **Sync**. 대시보드에서 손으로 되돌리면 다음 sync 때 다시 덮인다 |
| **비밀값이 문제** | 대시보드에서 값만 고친다. `sync: false` 라 Blueprint sync 로 덮이지 않는다 |
| **마이그레이션이 문제** | **Rollback 으로는 되돌아가지 않는다.** 아래 참조 |

**마이그레이션은 롤백 대상이 아니다.** `prisma migrate deploy` 는 적용만 하고 되돌리지
않는다. Render 의 Rollback 은 코드를 되돌릴 뿐 DB 스키마는 새 상태 그대로다. 그래서
스키마 변경은 **한 단계 전 코드와 호환되게** 만든다 — 컬럼을 지우기 전에 먼저 쓰지
않는 배포를 내보내고, 다음 배포에서 지운다. 되돌릴 수 없는 변경을 내보내야 한다면
Neon 콘솔에서 **먼저 브랜치(스냅샷)를 만든다.**

### 무료 플랜에서 알고 있어야 하는 것

| 사실 | 결과 |
| --- | --- |
| 15분 무활동 시 spin down, 재기동 약 1분 | 첫 방문이 느리다. TASK-0101 이 다룬다 |
| 무료 인스턴스 시간 **750h/월을 워크스페이스 전체가 공유** | 서비스 2개를 24시간 깨워 두면(2×730h) 한도를 넘어 **월말까지 정지**된다. 프리워밍을 "항상 깨우기"로 만들면 안 된다 |
| 영구 디스크 없음 | 재기동마다 검색 인덱스가 빈다 → 자동 재색인(TASK-0038) |
| Private Service 없음 | 검색 엔진이 공개 URL 을 갖는다. 마스터 키 없이는 전부 401 |
| Neon 은 5분 뒤 scale-to-zero | 첫 쿼리가 수백 ms 느리다. 타임아웃을 넉넉히 잡아 뒀다 |

## 문서

- 작업 계획: [`docs/tasks/`](./docs/tasks/)
- 결정 이력: [`docs/decisions/`](./docs/decisions/)
