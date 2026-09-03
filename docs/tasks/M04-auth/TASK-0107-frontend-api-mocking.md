# TASK-0107: 프론트 API 모킹 · 계약 고정

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M04 인증·계정 |
| 상태 | 승인 대기 |
| 작성일 | 2026-09-03 |
| 브랜치 | `feature/frontend-api-mocking` |
| 선행 작업 | TASK-0006, TASK-0106 |

## 1. 목적

**프론트 테스트가 백엔드 없이 돌게 하고, 그 대가로 생기는 드리프트를 계약 게이트로 막는다.**

지금 `apps/shop` · `apps/seller` · `apps/admin` 에는 **테스트 러너 자체가 없다.** `package.json` 에 `test` 스크립트가 없고 vitest 도 설치되어 있지 않다. `packages/ui` 만 jsdom 위에서 돌고, 그 컴포넌트들은 API 를 부르지 않는다.

그런데 `apps/shop/src/app/page.tsx` 는 이미 **Server Component 에서 `GET /api/v1/health` 를 부른다.** TASK-0023(인증 UI)부터는 세 앱 모두가 로그인·세션·권한을 API 로 조회하기 시작한다. 그 전에 "백엔드 없이, 응답을 우리가 통제하면서" 화면을 검증할 방법이 필요하다.

**모킹에는 대가가 있다.** 모킹 데이터가 실제 응답과 어긋나면 양쪽 테스트가 다 초록인데 앱이 깨진다 (QUALITY-GATES 5장).

```
프론트 테스트  { status: 'ok', database: 'ok' } 가 오면 3줄을 그린다     ✅
백엔드 테스트  /health 가 올바른 값을 만든다                              ✅
실제로는      백엔드가 필드명을 database → db 로 바꿨는데 아무도 못 잡음   ❌
```

이 작업이 끝나면 **위 세 번째 줄이 불가능해진다.** 스키마·백엔드·모킹 셋 중 둘이 어긋나면 정해진 스펙 하나가 반드시 빨개진다 (4.6).

## 2. 범위

### 포함

- **네트워크 레벨 모킹 도구 도입** — Server Component 의 `fetch` 까지 가로챈다 (4.1)
- **`packages/api-mocks` 신설** — 핸들러·픽스처·실패 헬퍼를 한 곳에 두고 세 앱이 공유 (4.3)
- **세 앱에 vitest + Testing Library 도입** — 설정은 `packages/config` 의 프리셋 1개로
- **모킹 픽스처를 `packages/shared` 의 zod 스키마로 검증** (C2) — 정의 시점 parse + 레지스트리 스펙 (4.4)
- **실패 응답 모킹** — 4xx · 5xx · 네트워크 단절 · 스키마 불일치 (U6 검증용)
- **드리프트 감지 경로 문서화와 실증** — 필드명을 일부러 바꿔 어느 스펙이 빨개지는지 (4.6, F1)

### 제외 (이번에 하지 않는 것)

- **백엔드 통합 테스트** — TASK-0106. C3(실제 응답을 같은 스키마로 parse)의 절반은 거기서 일어난다
- **인증 화면 자체** — TASK-0023. 이 TASK 는 그 화면이 쓸 기반만 만든다. 시범 대상은 이미 존재하는 `/health` 경로다
- **Storybook 연동** — TASK-0104. 다만 같은 핸들러를 브라우저에서 쓸 수 있도록 진입점(`browser.ts`)만 열어 둔다
- **E2E** — TASK-0099. Playwright 는 실 스택을 쓰므로 모킹하지 않는다
- **Lighthouse · 접근성 자동화** — TASK-0098
- **`packages/ui` 의 테스트 방식 변경** — 지금 방식(jsdom + RTL + user-event)이 그대로 표준이다. 여기서는 API 를 부르는 레이어만 추가한다

## 3. 요구사항

### 기능 요구사항

- [ ] 세 앱에서 `pnpm test` 가 돈다
- [ ] Server Component 를 렌더하는 테스트가 API 응답을 통제할 수 있다
- [ ] 프론트 테스트가 실 네트워크를 부르지 않는다
- [ ] 4xx · 5xx · 네트워크 단절 각각의 화면 상태를 검증할 수 있다
- [ ] 세 앱이 **하나의** 모킹 정의를 쓴다 (복붙 금지)
- [ ] 모킹 응답이 실제 스키마와 어긋나면 테스트가 실패한다

### 비기능 요구사항

- CI `test` job 증가분 30초 이하
- 핸들러를 추가할 때 손대는 파일은 `packages/api-mocks` 안쪽뿐 (앱 3개를 돌아다니지 않는다)

## 4. 설계

### 4.1 모킹 도구 선정

**제약이 도구를 결정한다.** `apps/shop/src/app/page.tsx` 는 async Server Component 이고, 그 안에서 `loadHealth()` → `getApiClient()` → `createApiClient` 가 **모듈 스코프에서** 만들어져 `globalThis.fetch` 를 부른다. 앱 코드에는 fetch 를 갈아끼울 이음매가 없다. 그러니 **전역 `fetch` 를 트랜스포트 레벨에서 가로채는 것**이 요건이다.

| 후보 | 판단 |
| --- | --- |
| **MSW (Mock Service Worker) 2.x** | **채택.** Node 에서 `globalThis.fetch` 를 인터셉터로 가로채므로 Server Component 의 fetch 가 그대로 잡힌다. 같은 핸들러가 브라우저(`setupWorker`)에서도 돌아 **Storybook(TASK-0104)이 재사용**할 수 있다. 4xx·5xx 본문과 네트워크 오류(`HttpResponse.error()`)를 모두 표현한다 |
| `vi.mock('@/lib/api')` — 모듈 모킹 | 탈락. **우리 코드를 우리가 대신 쓰는 것**이라 `createApiClient` 의 헤더·타임아웃·오류 분류·zod parse 가 전부 검증에서 빠진다. 앱마다 모킹을 따로 써야 하고, "500 응답이 오면"을 표현할 수 없다 |
| `createApiClient({ fetch })` — fetch 주입 | 탈락(주 수단으로는). 클라이언트는 이미 `FetchLike` 주입을 지원하고 `packages/shared` 의 클라이언트 스펙은 이 방식을 쓴다. 그러나 Server Component 는 클라이언트를 모듈 내부에서 만들므로 렌더 트리 전체에 fetch 를 꿰어야 한다 — 테스트를 위해 프로덕션 코드 모양을 비트는 것이 된다 |
| nock | 탈락. v14 에서 fetch 를 지원하지만 **Node 전용**이라 브라우저·Storybook 에서 같은 정의를 못 쓴다. 핸들러 문법이 체이닝 기반이라 응답 픽스처를 zod 로 검증하기에도 어색하다 |
| undici `MockAgent` | 탈락. `setGlobalDispatcher` 로 Node fetch 를 가로챌 수 있지만 Node 전용이고, 문법이 undici 에 묶여 있어 재사용 범위가 가장 좁다 |
| Playwright `page.route()` | 탈락. 브라우저 쪽 요청만 가로채므로 **서버 렌더 중의 fetch 는 원천적으로 못 잡는다.** E2E(TASK-0099)의 도구이지 컴포넌트 테스트의 도구가 아니다 |

**MSW 를 고르면서 확인한 것 두 가지.**

1. **Next.js 의 fetch 패치와 충돌하지 않는다.** Next 는 캐시를 위해 `globalThis.fetch` 를 감싸지만, 우리는 Next 런타임을 띄우지 않고 **컴포넌트 함수를 직접 호출**한다 (4.2). 패치가 설치되지 않으므로 MSW 가 최외곽이다. 게다가 `createApiClient` 는 이미 `cache: 'no-store'` 를 보낸다
2. **가로채기 시점 문제가 없다.** `createApiClient` 의 기본 fetch 는 `(input, init) => globalThis.fetch(input, init)` 로 **호출 시점에 전역을 읽는다.** 모듈 로드 시점에 캡처했다면 `server.listen()` 순서에 민감했겠지만 그렇지 않다

### 4.2 Server Component 를 어떻게 테스트하는가

async Server Component 는 **그냥 async 함수**다. Next 런타임 없이 호출해 결과 엘리먼트를 렌더한다.

```tsx
const ui = await HomePage()      // async Server Component 를 함수로 호출
render(ui)                       // 반환된 트리를 jsdom 에 그린다
expect(await screen.findByText('정상')).toBeVisible()
```

환경은 **`jsdom`** 이다. jsdom 은 `fetch` 를 제공하지 않으므로 `globalThis.fetch` 는 Node 의 것이고, MSW 의 Node 인터셉터가 바로 그것을 가로챈다. **DOM 단언과 서버 fetch 가로채기가 한 프로세스에서 성립한다** — 이 조합이 4.1 의 제약을 푸는 핵심이다.

한계와 대응:

| 한계 | 대응 |
| --- | --- |
| `cookies()` · `headers()` 등 Next 서버 API 를 쓰는 컴포넌트 | `vi.mock('next/headers')` 로 값을 준다. TASK-0023 부터 필요해진다 |
| 스트리밍·Suspense 경계의 실제 동작 | 이 레이어에서 검증하지 않는다. TASK-0099 E2E 의 몫 |
| `next/navigation` 의 `redirect()` | 던져지는 시그널을 단언한다 (권한 가드 테스트에서 필요) |

**폐기한 안**: Next 의 실험적 렌더 테스트 유틸리티에 기대는 것 — API 가 아직 안정되지 않았고, 그것이 흔들리면 세 앱의 테스트가 통째로 흔들린다. 컴포넌트를 함수로 부르는 방식은 React 의 계약에만 의존한다.

### 4.3 앱 3개가 모킹 정의를 공유하는 방법

**`packages/api-mocks` (`@shopping/api-mocks`) 를 신설한다.**

```
packages/api-mocks/
  src/
    define.ts            defineFixture(schema, value) — 정의 시점에 parse
    fixtures/health.ts   응답 픽스처
    handlers/health.ts   http.get(`*/api/v1/health`, () => HttpResponse.json(fixture))
    handlers/index.ts    기본 핸들러 묶음
    failures.ts          httpError(status, code) · networkError() · malformed()
    registry.ts          [스키마, 픽스처] 전수 목록 — C2 스펙의 입력
    node.ts              setupTestServer()  — vitest (setupServer)
    browser.ts           setupMockWorker()  — Storybook (setupWorker, TASK-0104)
```

| 후보 위치 | 판단 |
| --- | --- |
| **새 패키지 `packages/api-mocks`** | **채택.** `msw` 가 실 의존성으로 필요한데 프로덕션 번들에는 절대 들어가면 안 된다 — 패키지를 나누면 세 앱의 **devDependency** 로만 들어간다. Storybook·향후 Playwright 도 같은 정의를 쓴다 |
| `packages/shared` 안에 서브경로 | 탈락. `@shopping/shared` 는 `apps/api` 도 쓴다. 백엔드 의존성 트리에 msw 가 들어가고, `dist` 로 소비되므로 빌드 산출물도 커진다. 무엇보다 **스키마(계약)와 모킹(계약의 대역)이 한 패키지에 있으면 순환이 생긴다** |
| `packages/ui` 안에 | 탈락. ui 는 표현 레이어다. API 경로를 알아야 할 이유가 없다 |
| 앱마다 `apps/*/test/mocks` | 탈락. 요구사항이 정확히 이것을 금지한다. 세 벌이 되는 순간 하나만 고쳐지고, 그 상태가 눈에 띄지 않는다 |

**설정도 한 벌이다.** vitest 설정은 `packages/config` 에 Next 앱용 프리셋을 두고 세 앱이 확장한다 (`packages/config` 는 이미 eslint·tsconfig·prettier 프리셋을 담당한다). 각 앱의 `vitest.config.mjs` 는 프리셋을 부르는 몇 줄이고, `test/setup.ts` 는 `setupTestServer()` 호출이 전부다.

**핸들러는 호스트를 고정하지 않는다.** 세 앱의 `NEXT_PUBLIC_API_URL` 이 다를 수 있으므로 경로 패턴(`*/api/v1/health`)으로 매칭한다.

**앱별 차이는 오버라이드로 표현한다.** `server.use(...)` 로 한 테스트 안에서만 핸들러를 바꾼다. 기본 묶음은 언제나 "정상 응답"이고, 이상 상황은 각 테스트가 명시적으로 선언한다.

### 4.4 C2 — 모킹 데이터를 zod 스키마로 검증

두 겹으로 건다.

**1. 정의 시점.** 픽스처는 `defineFixture` 로만 만든다.

```ts
export const healthOk = defineFixture(healthResponseSchema, {
  status: 'ok', database: 'ok', search: 'ok', uptime: 12.5, version: '0.0.0',
})
```

`defineFixture` 는 모듈 로드 시 `schema.parse` 를 돌린다. 스키마와 어긋난 픽스처는 **그 픽스처를 import 하는 모든 스펙이 즉시 터진다.** 타입만으로는 부족하다 — `uptime` 이 음수여도 타입은 통과하지만 `nonnegative()` 는 통과하지 못한다.

**2. 레지스트리 스펙.** `registry.ts` 가 `[스키마, 픽스처들]` 을 전수 나열하고, 스펙이 전부 parse 한다. 여기에 더해 **`fixtures/` 에서 export 되는 모든 값이 `defineFixture` 를 거쳤는지** 확인한다 (브랜드 심볼 검사). 이게 없으면 누군가 평범한 객체 리터럴로 픽스처를 하나 추가하고 검증을 빠져나간다.

### 4.5 C3 와 어떻게 맞물리는가

**계약 게이트는 두 TASK 에 걸쳐 있고, 어느 한쪽만으로는 아무 효과가 없다.**

```
              packages/shared/src/**  ← zod 스키마 한 벌 (C1: 단일 출처)
                     │
        ┌────────────┴─────────────┐
        │                          │
  TASK-0107 (이 문서)         TASK-0106
  프론트 모킹 픽스처를         백엔드 통합 테스트가
  같은 스키마로 parse          실제 응답을 같은 스키마로 parse
        (C2)                       (C3)
```

C3 는 TASK-0106 의 하네스에서 **구조적으로** 성립한다. 그 하네스는 Nest 앱을 임시 포트에 띄우고 `@shopping/shared` 의 `createApiClient` 로 호출하는데, 이 클라이언트는 응답을 이미 zod 로 parse 하고 실패하면 `ApiClientError { kind: 'malformed_response' }` 를 던진다. **백엔드 테스트를 쓰는 사람이 parse 를 잊는 경로가 없다.**

C2 는 이 TASK 가 같은 방식으로 만든다 — 픽스처를 쓰는 경로가 `defineFixture` 하나뿐이다.

**둘 중 하나만 있으면 드리프트가 그대로 남는다.** C2 만 있으면 "모킹은 스키마와 맞지만 백엔드가 스키마와 다른" 상태를, C3 만 있으면 "백엔드는 맞지만 모킹이 낡은" 상태를 못 잡는다.

### 4.6 계약이 깨지면 무엇이 빨개지는가

**세 조각 — 스키마 / 백엔드 / 모킹 픽스처 — 중 어느 하나만 바뀌면 정해진 스펙이 빨개진다.** 백엔드가 `/health` 의 `database` 를 `db` 로 바꾸는 상황으로 네 경우를 전부 적는다.

| # | 무엇이 바뀌었나 | 빨개지는 것 | 왜 |
| --- | --- | --- | --- |
| 1 | **백엔드만** (스키마·모킹 그대로) | **TASK-0106 의 `/health` 통합 스펙** — `createApiClient` 가 `malformed_response`, 메시지에 `database` 경로가 찍힌다 | 실제 응답이 스키마와 다르다. 프론트는 초록이고 **그게 맞다** — 틀린 쪽은 백엔드다 |
| 2 | **스키마 + 백엔드** (모킹을 안 고침) | **이 TASK 의 레지스트리 스펙** (`registry.spec.ts`) — `healthOk` 픽스처가 `db` 를 갖고 있지 않아 `parse` 실패. 더해 `pnpm typecheck` 도 실패 (`HealthResponse` 를 쓰는 앱 코드) | 모킹이 낡았다 |
| 3 | **스키마 + 모킹** (백엔드를 안 고침) | **TASK-0106 의 `/health` 통합 스펙** (1번과 같은 실패) | 백엔드가 낡았다 |
| 4 | **스키마만** | **양쪽 다** + `pnpm typecheck` | 아무도 따라오지 않았다 |

**모든 경우가 잡힌다.** 계약이 어긋난 채로 양쪽이 초록인 조합은 없다. 이것이 QUALITY-GATES 5장이 요구하는 것이고, 이 TASK 의 F1(드리프트 훈련)은 위 표의 1·2·4 를 **실제로 실행해서** 기대한 스펙만 빨개지는 것을 확인한다.

### 4.7 실패 응답 모킹 (U6)

`apps/shop/src/lib/health.ts` 의 `HealthFailureReason` 은 이미 닫힌 집합이다 — `network` · `timeout` · `aborted` · `http` · `malformed_response` · `configuration` · `unknown`. 화면(`HealthPanel`)은 이 7가지를 각각 다른 문구로 그린다. **전부 검증한다.**

| 상황 | 만드는 방법 | 기대 |
| --- | --- | --- |
| 4xx (`http`) | `HttpResponse.json(apiErrorFixture, { status: 404 })` — 본문은 `apiErrorSchema` 봉투 | 오류 문구 + `role="alert"` |
| 5xx (`http`) | 위와 같고 status 500 | 〃 |
| 네트워크 단절 (`network`) | `HttpResponse.error()` | 〃 |
| 스키마 불일치 (`malformed_response`) | 필드를 뺀 응답 — **의도적으로 `defineFixture` 를 쓰지 않는 유일한 곳**, `failures.ts` 에 격리 | 〃 |
| 설정 누락 (`configuration`) | `NEXT_PUBLIC_API_URL` 미설정 | 〃 |
| `timeout` · `aborted` | **컴포넌트 레벨에서는 만들지 않는다** — 아래 참조 | 〃 |

**`timeout` 은 두 곳으로 나눠 검증한다.** `loadHealth()` 는 타임아웃 값을 넘기지 않으므로 실제 5초를 기다려야 재현되는데, 그 시간을 테스트가 부담할 이유가 없다. 그래서

- **매핑**(오류 → `reason`)은 `packages/shared` 의 클라이언트 스펙에서 `timeoutMs: 10` 을 주입해 검증한다 (이미 가능한 경로다)
- **렌더**는 `HealthPanel` 에 `{ ok: false, reason: 'timeout' }` 을 prop 으로 직접 줘서 검증한다 — 이 컴포넌트는 결과를 prop 으로 받으므로 7가지 전부를 값으로 만들 수 있다

`aborted` 도 같다. **왕복 전체를 태워야만 검증되는 것이 아니면 태우지 않는다.**

### 4.8 실 API 를 부르지 않는 것을 어떻게 보장하는가

세 겹이다.

1. **`server.listen({ onUnhandledRequest: 'error' })`** — 핸들러가 없는 요청은 통과가 아니라 즉시 실패다. "조용히 진짜로 나가는" 경로가 사라진다
2. **테스트 환경의 base URL 을 `.invalid` TLD 로 둔다** — `NEXT_PUBLIC_API_URL=http://api.test.invalid`. 1번을 어떻게든 빠져나가도 DNS 에서 즉시 실패하며, **개발자의 로컬 API 를 우연히 때리는 일**이 원천적으로 불가능해진다
3. **`request:unhandled` 이벤트 카운터** — `setupTestServer()` 가 카운터를 걸고, 실행이 끝날 때 0이 아니면 실패시킨다. 1번이 던진 오류를 어떤 스펙이 `try/catch` 로 삼키더라도 총계에서 드러난다

## 5. 구현 계획

1. **`packages/api-mocks` 골격** — `define.ts`, `registry.ts`, `node.ts`, `browser.ts`. msw 도입
2. **`/health` 핸들러와 픽스처** — 정상 1개 + `failures.ts` (4xx·5xx·네트워크·malformed)
3. **C2 레지스트리 스펙** — 전수 parse + `defineFixture` 브랜드 검사
4. **`packages/config` 에 Next 앱용 vitest 프리셋** 추가
5. **`apps/shop` 에 vitest 도입** — `test` 스크립트, 설정, `test/setup.ts`. `HomePage()` Server Component 스펙과 `HealthPanel` 상태 스펙
6. **`apps/seller` · `apps/admin` 에 같은 프리셋 적용** — 각 앱 최소 1개 스펙
7. **네트워크 차단 검증** — `onUnhandledRequest: 'error'`, `.invalid` base URL, 카운터
8. **드리프트 훈련** — 4.6 표의 1·2·4 를 실제로 실행하고 결과를 6.1 F1 에 기록. 원복 후 전체 재통과 확인
9. 문서 — `README.md` 테스트 절에 프론트 규약 추가, 핸들러 추가 절차

## 6. 완료 기준 (Definition of Done)

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | **드리프트가 실제로 잡힌다** | 4.6 표의 조작 3종을 실행하고 `pnpm test` · `pnpm typecheck` 결과를 기록. ① 백엔드 응답 필드명만 변경 ② 스키마+백엔드 변경, 픽스처 방치 ③ 스키마만 변경 | **3/3 에서 표가 지목한 스펙만 실패**하고 나머지는 통과. ①은 `apps/api` 의 `/health` 통합 스펙, ②는 `packages/api-mocks` 의 `registry.spec.ts`(+typecheck), ③은 양쪽 모두. 각 조작을 원복하면 전부 통과 | [ ] |
| F2 | **프론트 테스트가 실 API 를 부르지 않는다** | `request:unhandled` 카운터 + 실행 중 아웃바운드 연결 확인 | **네트워크 호출 0건.** `onUnhandledRequest: 'error'` 설정, base URL 이 `.invalid` TLD | [ ] |
| F3 | **앱 3개가 같은 모킹 정의를 쓴다** | 저장소 grep | `apps/*/test/setup.ts` 에서 `@shopping/api-mocks` import **3/3**. `packages/api-mocks` **밖**에서 `from 'msw'` **0건**. 핸들러·픽스처 정의 파일 중복 **0건** | [ ] |
| F4 | Server Component 의 fetch 가 가로채진다 | `apps/shop` 홈 스펙 — `await HomePage()` 렌더 | 모킹한 `version`·`uptime` 값이 화면에 나타난다. 같은 스펙에서 네트워크 호출 0건 | [ ] |
| F5 | **실패 응답 4종** | 4.7 표 | 4xx · 5xx · 네트워크 단절 · 스키마 불일치 각각에서 `role="alert"` 와 해당 문구 표시. **U6 충족** | [ ] |
| F6 | 실패 상태 전수 렌더 | `HealthPanel` 스펙 — `HealthFailureReason` 7종 | **7/7** 각각 고유한 문구가 표시된다 (미구현 상태 0) | [ ] |
| F7 | **C2 — 픽스처가 스키마를 통과한다** | `packages/api-mocks/src/registry.spec.ts` | 등록 픽스처 **전수 parse 통과**. `fixtures/` 의 export 중 `defineFixture` 를 거치지 않은 것 **0건** | [ ] |
| F8 | C1 — 스키마 단일 출처 | grep | 세 앱과 `packages/api-mocks` 에서 응답 타입을 재정의한 `interface`/`type` **0건**. 전부 `@shopping/shared` 에서 import | [ ] |
| F9 | 세 앱에 테스트 러너가 있다 | `pnpm test` | shop · seller · admin 각각 vitest 실행, 스펙 **각 1개 이상**, 실패 0 | [ ] |
| F10 | 설정 중복 없음 | 세 앱의 `vitest.config.mjs` diff | 프리셋 import 를 제외한 실질 차이 **0줄**. 프리셋은 `packages/config` 에 **1개** | [ ] |
| F11 | CI 소요 시간 | 도입 전후 `test` job 시간 비교 | 증가분 **30초 이하** | [ ] |
| F12 | 핸들러 추가 비용 | 새 엔드포인트 모킹을 하나 추가해 보고 변경 파일 수를 센다 | `packages/api-mocks` **안쪽만**. `apps/**` 변경 0건 | [ ] |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:

- **Q5 면제** — M05 부터 적용. 이 TASK 는 프론트 테스트 레이어 **자체**를 만드는 작업이며, 그 검증은 F1~F12 가 대신한다
- **2장 화면 게이트**: 새 화면을 만들지 않으므로 P1·P3·P6 해당 없음. P5(로딩/빈/에러)는 **기존 `/health` 화면의 에러 상태를 테스트로 고정**하는 형태로만 관여한다
- **3장 API 게이트 해당 없음** — 엔드포인트를 추가하지 않는다
- **4장 데이터 게이트 해당 없음** — 스키마를 바꾸지 않는다
- **5장 계약 게이트**: **C1·C2 가 이 TASK 의 본체**다 (F7·F8). **C3 는 TASK-0106** 이 담당하며, 이 TASK 는 F1 의 드리프트 훈련으로 **두 짝이 실제로 맞물리는 것**까지 확인한다

UI 상호작용 목록(QUALITY-GATES Q5)에서 이번 TASK 에 해당하는 항목:

| # | 항목 | 이번 TASK 에서 |
| --- | --- | --- |
| U1 | 조건부 렌더 4상태 | 정상·에러를 모킹으로 만든다. 로딩·빈 상태는 대상 화면이 생기는 TASK-0023 부터 |
| U2 | 폼 검증 오류 표시 | **범위 밖** — 폼이 없다. TASK-0017 · 0023 |
| U3 | 제출 중 중복 클릭 차단 | **범위 밖** — 제출이 없다 |
| U4 | 밀도 3단계 렌더 | **해당 없음** — 밀도에 반응하는 새 컴포넌트가 없다 |
| U5 | 키보드만으로 조작 | **해당 없음** — 상호작용 요소를 추가하지 않는다 |
| U6 | **서버 오류 표시** | **이 TASK 의 대상.** 4xx·5xx·네트워크 단절·스키마 불일치를 모킹해 검증 (F5) |

### 6.3 성능 · 접근성

**해당 없음** — 새 화면이 없다. 성능 기준은 F11(CI 소요 시간)이 대신한다.

### 6.4 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 이 문서의 상태를 `완료` 로 변경하고 인덱스 2곳(`docs/tasks/README.md`, `docs/tasks/M04-auth/README.md`) 갱신 | [ ] |
| D2 | 프론트 테스트 규약과 핸들러 추가 절차를 `README.md` 에 반영 | [ ] |
| D3 | 새 환경변수(테스트용 `NEXT_PUBLIC_API_URL`)를 `.env.example` 에 명시 | [ ] |
| D5 | 도입한 라이브러리 버전을 8장에 기록 | [ ] |

D1 의 인덱스 2곳은 병행 작업 중 충돌을 막기 위해 **오케스트레이터가 별도 커밋으로 갱신**한다.

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | Next 가 향후 `globalThis.fetch` 를 더 깊이 감싸 MSW 와 충돌 | 우리는 Next 런타임을 띄우지 않고 컴포넌트를 함수로 부르므로 노출면이 작다. 그래도 깨지면 fetch 주입 경로(4.1 두 번째 후보)가 남아 있다 — `getApiClient()` 에 테스트 전용 주입점을 여는 것이 최소 변경이다 |
| R2 | 세 앱에 vitest 를 넣으면 `pnpm test` 가 길어진다 | F11 로 상한을 건다. 지금 세 앱의 스펙 수가 적어 증가분은 러너 부팅이 대부분이다 |
| R3 | 픽스처가 늘면서 "실제 응답과 그럴듯하지만 다른" 값이 쌓인다 | C2 가 **형태**는 보장하지만 **값의 현실성**은 보장하지 않는다. 대응: 픽스처는 TASK-0106 의 통합 테스트가 실제로 받은 응답을 옮겨 적는 것에서 출발한다. 자동 동기화(응답 녹화)는 이번 범위 밖 — 필요해지면 별도 TASK |
| R4 | Server Component 가 `cookies()` 를 쓰기 시작하면 모킹 대상이 늘어난다 | TASK-0023 이 `next/headers` 대역을 `packages/api-mocks` 에 함께 추가한다. 이 TASK 는 그 자리를 비워 둔다 |
| R5 | `onUnhandledRequest: 'error'` 가 폰트·이미지 같은 무해한 요청까지 막는다 | jsdom 은 리소스를 기본적으로 로드하지 않는다. 예외가 필요하면 `packages/config` 프리셋 한 곳에서 허용 목록을 관리한다 |
| R6 | TASK-0106 이 먼저 머지되지 않으면 F1 의 드리프트 훈련 ①·③ 을 실행할 수 없다 | 선행 작업에 TASK-0106 을 명시했다. 문서 작성·구현은 병행 가능하지만 **완료 판정은 TASK-0106 머지 이후**다 |

## 8. 확정된 버전

구현 시 채운다.

| 패키지 | 버전 | 용도 |
| --- | --- | --- |
| msw | | 네트워크 레벨 모킹 (`packages/api-mocks` 의 dependency) |
| vitest | | 세 앱의 테스트 러너 (dev). `packages/ui`·`apps/api` 와 같은 버전으로 맞춘다 |
| jsdom | | 세 앱의 테스트 환경 (dev) |
| @testing-library/react | | 렌더·질의 (dev) |
| @testing-library/jest-dom | | DOM 매처 (dev) |
| @testing-library/user-event | | 실제 키·클릭 입력 (dev) |
| @testing-library/dom | | 위 두 개의 peer (dev) |

Testing Library 4종은 `packages/ui` 가 이미 쓰고 있는 것과 **같은 버전으로 고정한다** — 두 벌이 되면 매처 동작이 패키지마다 달라진다.

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-03 | 최초 작성. D-207(테스트 레이어와 대역 규약)의 프론트·계약 절반을 실행 가능하게 만드는 TASK 로 신설 |
