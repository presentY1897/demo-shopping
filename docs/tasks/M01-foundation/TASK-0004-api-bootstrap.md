# TASK-0004: API 부트스트랩

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M01 기반 구축 |
| 상태 | 완료 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/api-bootstrap` |
| 선행 작업 | TASK-0002, TASK-0003 |

## 1. 목적

NestJS API 를 띄우고, 환경변수 검증과 헬스체크를 붙인다. 이후 모든 백엔드 작업이 여기에 얹힌다.

## 2. 범위

### 포함
- NestJS 애플리케이션 구성 (`apps/api`)
- **부팅 시 env 스키마 검증** (zod) — 누락·형식 오류 시 프로세스 종료
- `GET /health` — API 자신과 Meilisearch 연결 상태 반환 (DB 는 TASK-0005 에서 추가)
- 전역 예외 필터, 응답 포맷 통일, 요청 로깅
- CORS 설정 (세 웹 앱 오리진 허용)
- API 프리픽스 및 버전 규약 (`/api/v1`)
- **`PORT_OFFSET` 반영** — 아래 참조

### `PORT_OFFSET` 반영 (TASK-0003 에서 이월)

TASK-0003 이 인프라 포트를 `PORT_OFFSET` 에서 파생시켰지만, `.env.example` 의 `DATABASE_URL` · `MEILI_HOST` · `API_PORT` · `NEXT_PUBLIC_API_URL` 에는 포트가 문자열로 박혀 있었다. 오프셋이 있는 워크트리마다 이 값들을 손으로 고쳐야 했다.

env 검증 계층이 이 TASK 에서 생기므로 여기서 해소한다. **`.env` 에 포트가 없으면 `scripts/ports.mjs` 의 `resolvePorts()` 로 채우고, 명시돼 있으면 그 값을 그대로 쓴다.**

해소 방법:

1. `.env.example` 에서 포트가 들어가는 값을 **주석 처리**했다. 기본 상태의 `.env` 에는 이 값들이 없다.
2. API 는 부팅 시 저장소 루트를 찾아 `.env.local` → `.env` 순으로 읽고(`process.loadEnvFile` 은 이미 설정된 값을 덮어쓰지 않으므로 셸 > `.env.local` > `.env` 우선순위가 유지된다), `scripts/ports.mjs` 를 **런타임에 import** 해 다음을 계산한다.

   | 변수 | 파생 규칙 |
   | --- | --- |
   | `API_PORT` | `4000 + PORT_OFFSET` (없으면 `PORT` 를 먼저 본다 — Render·Railway 가 주입) |
   | `MEILI_HOST` | `http://localhost:(7700 + PORT_OFFSET)` |
   | `DATABASE_URL` | `postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:(5432 + PORT_OFFSET)/$POSTGRES_DB` |
   | `CORS_ORIGINS` | shop·seller·admin 오리진 (`localhost` · `127.0.0.1` 양쪽) |

3. 파생값은 실제 환경변수 **아래에** 깔린다. 명시된 값은 덮이지 않으므로 Neon 의 `DATABASE_URL` 이나 플랫폼이 주는 `PORT` 가 그대로 동작한다.
4. 워크스페이스가 없는 환경(배포된 `dist` 단독 실행)에서는 파생이 동작하지 않고, 빠진 변수는 부팅 검증에서 이름과 함께 보고된다.

`scripts/ports.mjs` 의 기본 포트를 복제하지 않고 런타임 import 를 택한 이유는 단일 출처를 둘로 만들지 않기 위해서다. 포트 정의가 바뀌면 그 파일만 고치면 된다.

**`NEXT_PUBLIC_API_URL` 은 이 TASK 범위 밖이다.** Next.js 앱이 읽는 값이고 `apps/shop|seller|admin` 은 TASK-0006 이 만든다. `.env.example` 에서 주석 처리하고, TASK-0006 이 각 앱 설정에서 `portFor('api')` 로 파생하도록 안내를 남겼다. (TASK-0006 의 F5b·F6 가 이를 검증한다.)

### 제외
- Prisma·DB 연결 (TASK-0005) — `DATABASE_URL` 은 검증만 하고 연결하지 않는다
- 인증 (M04)
- 도메인 모듈 일체

## 3. 요구사항

### 기능 요구사항
- [x] `pnpm --filter @shopping/api dev` 로 API 가 뜬다
- [x] `GET /api/v1/health` 가 `{ status, search, uptime, version }` 을 반환한다
- [x] Meilisearch 가 죽어 있으면 `search: "down"` 을 반환하되 API 자체는 200 을 유지한다
- [x] 필수 환경변수 누락 시 **부팅 시점에** 누락 변수명을 포함한 메시지와 함께 종료한다
- [x] 처리되지 않은 예외가 통일된 에러 응답 포맷으로 변환된다
- [x] 허용되지 않은 오리진의 요청은 CORS 로 차단된다

### 비기능 요구사항
- [x] 에러 응답에 스택 트레이스가 노출되지 않는다 (개발 환경 제외)
- [x] 로그에 환경변수 값이 찍히지 않는다 — 검증 실패 메시지는 **변수명과 제약조건만** 출력한다

## 4. 설계

```
apps/api/src/
├── main.ts                       부트스트랩: 프리픽스·버전·CORS·미들웨어·종료 처리
├── app.module.ts
├── config/                       env 스키마 정의와 검증
│   ├── app-config.ts             AppConfig 인터페이스 + APP_CONFIG 토큰
│   ├── config.module.ts          검증이 끝난 설정을 DI 에 공급 (@Global)
│   ├── env.schema.ts             zod 스키마와 한국어 실패 사유
│   ├── env-validation.error.ts   부팅 실패 리포트
│   ├── derived-env.ts            scripts/ports.mjs 런타임 import → 파생값
│   ├── merge-env.ts              파생값을 실제 환경 아래에 깔기
│   ├── origins.ts                CORS_ORIGINS 파싱·정규화
│   ├── workspace.ts              저장소 루트 탐색 + .env 로딩
│   ├── package-version.ts        헬스체크가 보고할 버전
│   └── load-app-config.ts        위 단계를 순서대로 실행
├── common/                       예외 필터, 에러 응답, 로거
│   ├── all-exceptions.filter.ts
│   ├── error-response.ts         에러 envelope 생성·전송 (필터와 404 폴백이 공유)
│   ├── http-error-code.ts        HTTP 상태 → 코드·한국어 메시지
│   ├── not-found.middleware.ts   프리픽스 밖 경로의 최종 404
│   └── request-context.middleware.ts  요청 ID 부여 + 요청 로깅
└── health/                       헬스체크 모듈
    ├── health.controller.ts
    ├── health.service.ts
    ├── health-indicator.ts       HealthIndicator 인터페이스 + 멀티 토큰
    ├── health.module.ts
    └── search.health-indicator.ts
```

### API

| 메서드 | 경로 | 응답 |
| --- | --- | --- |
| GET | `/api/v1/health` | `{ status, search, uptime, version }` |

### 응답 포맷 결정

- **성공 응답은 감싸지 않는다.** 헬스체크 응답이 `{ status, search, ... }` 그대로인 것이 규약이다. 목록 응답의 페이지네이션 형태는 해당 TASK 가 정의한다.
- **에러 응답은 항상 아래 한 가지 형태다.** 프레임워크의 영어 메시지를 그대로 흘리지 않고 상태 코드별 한국어 메시지를 쓴다. 호출자가 필요로 하는 정보는 `details` 에 담는다.

```jsonc
{ "error": { "code": "NOT_FOUND", "message": "요청한 경로를 찾을 수 없습니다.", "details": [] } }
```

- 모든 응답에 `X-Request-Id` 를 붙이고 같은 값으로 서버 로그를 남긴다. 스택 트레이스는 응답이 아니라 **로그에만** 남는다 (`NODE_ENV=development` 의 5xx 응답은 예외).
- Nest 는 자체 404 핸들러를 **전역 프리픽스 아래에만** 걸기 때문에 `/api` 밖 경로는 Express 의 HTML 오류 페이지로 빠진다. `app.init()` 이후 최종 미들웨어를 하나 더 붙여 이것도 같은 envelope 으로 만든다.

### 헬스체크 확장 방식

`HealthIndicator`(`key` + `check()`) 를 구현해 `HEALTH_INDICATORS` 토큰에 등록하면 `HealthService` 가 병렬로 호출한다. TASK-0005 는 `database` 키를 `packages/shared` 의 `healthDependencyKeys` · `healthResponseSchema` 에 추가하고 인디케이터를 하나 등록하면 된다.

`status` 는 의존성이 전부 `ok` 일 때만 `ok`, 하나라도 아니면 `degraded` 다. **`down` 이 되는 경우는 없다** — 이 코드가 실행됐다는 것 자체가 API 가 살아 있다는 뜻이고, 검색 장애로 인스턴스가 로드밸런서에서 빠지면 안 된다.

## 5. 구현 계획

1. NestJS 스캐폴딩 + `packages/config` 설정 연결
2. env 스키마(zod) 정의와 부팅 시 검증
3. 전역 예외 필터 / 응답 인터셉터 / 로거
4. CORS 설정
5. health 모듈 + Meilisearch 연결 확인
6. health 단위 테스트

## 6. 완료 기준 (Definition of Done)

> 검증은 이 워크트리(`PORT_OFFSET=40`)에서 실행했다. 아래 포트는 `4000 + 40` 이다.

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 기동 | `pnpm --filter @shopping/api dev` | 지정 포트에서 응답 | [x] |
| F2 | 헬스체크 | `curl localhost:4040/api/v1/health` | 200, `search: "ok"` | [x] |
| F3 | 검색엔진 장애 격리 | Meilisearch 중지 후 헬스체크 | 200 유지, `search: "down"` | [x] |
| F4 | env 누락 차단 | `MEILI_MASTER_KEY` 제거 후 `pnpm --filter @shopping/api start` | 누락 변수명 출력 후 종료 코드 1 | [x] |
| F5 | 에러 포맷 | 존재하지 않는 경로 요청 | 통일 포맷 JSON, 스택 미노출 | [x] |
| F6 | CORS | 허용되지 않은 오리진에서 요청 | `Access-Control-Allow-Origin` 없음 | [x] |
| F7 | 포트 오프셋 | `PORT_OFFSET=50 pnpm --filter @shopping/api dev` | 파일 수정 없이 4050 에서 응답 | [x] |

- **F4 의 변수를 `DATABASE_URL` 에서 `MEILI_MASTER_KEY` 로 바꿨다.** 이 TASK 에서 `DATABASE_URL` 은 `PORT_OFFSET` 에서 파생되므로 더 이상 "제거하면 누락"이 되지 않는다. 안전한 기본값을 줄 수 없는 값(비밀값)이라야 이 기준이 의미가 있어서 `MEILI_MASTER_KEY` 로 교체했다. 형식 오류(`API_PORT=사천사십`)와 복수 항목 동시 보고도 함께 확인했다.
- **F7 은 이월 사항 검증용으로 추가**했다.
- 종료 코드는 비-watch 실행(`start` / `node dist/main.js`)으로 측정한다. `dev` 는 `nest start --watch` 라 같은 메시지를 출력한 뒤 프로세스를 재시작하려고 대기하며, 이것이 watch 모드의 정상 동작이다.

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:

- **Q5(커버리지) 면제** — M05 부터 적용
- **Q6~Q7 해당 없음** — TASK-0007 에서 구축
- **3장 API 게이트**: A1(응답시간) 적용. A2~A4 는 인증 도입(M04) 이후 적용
- **4장(데이터) 해당 없음** — 스키마 없음

| # | 결과 |
| --- | --- |
| Q1 `pnpm typecheck` | error 0 |
| Q2 `pnpm lint` | error 0, warning 0 |
| Q3 `pnpm build` | 전 패키지 성공 |
| Q4 `pnpm test` | 8 파일 43 테스트 통과 (vitest) |
| A1 응답시간 | p95 2.17ms (목표 300ms 이하) |

### 6.3 성능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| P1 | 기동 시간 | 실행부터 첫 200 응답까지 | 10초 이내 → **실측 2.35초** | [x] |
| P2 | 헬스체크 응답 | 로컬 100회 호출 p95 | 100ms 이하 → **실측 2.17ms** (중앙값 1.79ms, 최대 3.07ms) | [x] |

### 6.4 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D3 | 새 환경변수를 `.env.example` 에 반영 | [x] |
| D1 | 상태 갱신 + 인덱스 2곳 | [x] 상태 갱신 / 인덱스 2곳은 머지 시점에 갱신 |
| D5 | 확정 버전 기록 | [x] |

## 7. 리스크 / 열린 질문

| # | 내용 | 결과 |
| --- | --- | --- |
| R1 | pnpm workspace 에서 NestJS 빌드 시 의존성 해석 실패 | 발생하지 않음. hoist·`node-linker` 조정 불필요 |
| R2 | TypeScript 6 는 `node_modules/@types` 를 자동으로 포함하지 않는다 | `apps/api/tsconfig.json` 에 `"types": ["node"]` 를 명시. Next 앱은 필요한 타입이 다르므로 공유 프리셋이 아니라 앱별로 선언하는 편이 맞다 |
| R3 | `app.setGlobalPrefix('api')` 로는 Nest 의 404 핸들러가 걸리지 않는다 | 프리픽스는 `/api` 로 선행 슬래시를 붙이고, 프리픽스 밖 경로는 최종 미들웨어가 처리 |
| R4 | `pnpm typecheck` · `pnpm lint` 는 `packages/shared/dist` 가 있어야 통과한다 | 기존 성질이다. `pnpm install`(shared 의 `prepare`)과 `pnpm build` 가 만들어 주므로 정상 흐름에서는 문제가 없다. CI 구성(TASK-0007)에서 `install → build → typecheck` 순서를 못박을 것 |

## 8. 확정된 버전

| 패키지 | 버전 | 비고 |
| --- | --- | --- |
| @nestjs/core | 12.0.1 | |
| @nestjs/common | 12.0.1 | |
| @nestjs/platform-express | 12.0.1 | express 5.2.1 |
| @nestjs/cli | 12.0.0 | `dev`(watch)·`build`. typescript `~6.0.2` 의존이라 6.0.3 과 맞는다 |
| reflect-metadata | 0.2.2 | |
| rxjs | 7.8.2 | @nestjs/core peer |
| zod | 4.5.4 | `packages/shared` 와 동일 버전 |
| vitest | 4.1.11 | 테스트 러너 (신규 도입) |
| @types/node | 24.13.3 | Node 24.13.1 |
| meilisearch (client) | 미도입 | 헬스체크는 `/health` 한 번의 GET 이라 네이티브 `fetch` + `AbortSignal.timeout` 으로 충분하다. 클라이언트는 색인 파이프라인을 만드는 M06 에서 도입한다 |

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-02 | 승인 — M01 착수 |
| 2026-09-02 | 완료. NestJS 부트스트랩 · zod 부팅 검증 · `PORT_OFFSET` 파생 · `/api/v1/health` · 통일 에러 포맷 · CORS · vitest 도입 |
