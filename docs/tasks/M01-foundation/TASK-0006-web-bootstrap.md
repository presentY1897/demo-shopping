# TASK-0006: 웹 앱 3종 부트스트랩

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M01 기반 구축 |
| 상태 | 완료 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/web-bootstrap` |
| 선행 작업 | TASK-0002, TASK-0004 |

## 1. 목적

구매자·판매자·관리자 Next.js 앱 3개를 띄우고 API 와 연결한다. 세션이 앱별로 독립이라는 전제를 구조로 못박는다.

## 2. 범위

### 포함
- `apps/shop`, `apps/seller`, `apps/admin` — Next.js App Router + TypeScript
- Tailwind CSS 설치 및 공통 프리셋 연결
- 각 앱의 API 클라이언트 (`packages/shared` 의 타입 사용, 에러 포맷 처리)
- 각 앱의 확인용 루트 페이지 — `/health` 응답에 들어 있는 상태 항목 표시[^db]
- 앱별 포트 분리 (`3000` / `3001` / `3002`, **`PORT_OFFSET` 적용**)
- 루트 `dev` 스크립트에서 API + 웹 3개 병렬 실행

### 제외
- 디자인 토큰·밀도 3단계 (M03)
- 공통 UI 컴포넌트 (`packages/ui` 는 M03)
- 인증·미들웨어 권한 검사 (M04)
- 실제 화면 (각 도메인 마일스톤)

## 3. 요구사항

### 기능 요구사항
- [x] `pnpm dev` 로 API 1개 + 웹 3개가 동시에 뜬다
- [x] 세 앱의 루트 페이지가 각각 `/health` 를 호출해 응답에 있는 상태 항목을 표시한다[^db]
- [x] API 가 죽어 있으면 화면이 깨지지 않고 오류 상태를 표시한다
- [x] `packages/shared` 의 타입이 응답 타입으로 사용된다
- [x] 각 앱이 서로 다른 포트에서 독립적으로 뜬다

### 비기능 요구사항
- 확인용 페이지는 디자인 대상이 아니다. M03 에서 교체된다
- Tailwind 설정은 3개 앱이 공유 프리셋을 확장하는 형태로 둔다 (M03 의 토큰 도입을 대비)
- API 클라이언트는 앱마다 복붙하지 않고 `packages/shared` 에 둔다

## 4. 설계

```
apps/shop/    포트 3000 + PORT_OFFSET   구매자
apps/seller/  포트 3001 + PORT_OFFSET   판매자
apps/admin/   포트 3002 + PORT_OFFSET   관리자

apps/*/src/
├── app/          App Router (layout.tsx · page.tsx · globals.css)
├── components/   앱 전용 컴포넌트
├── lib/          api.ts (앱별 클라이언트 인스턴스) · health.ts
└── messages/     UI 문구 카탈로그. 컴포넌트는 types.ts 만 본다

packages/shared/src/api/          fetch 래퍼, 에러 분류, 상태 항목 추출
packages/config/tailwind/preset.css   세 앱이 확장하는 Tailwind 공통 프리셋
scripts/web-app.mjs               PORT · NEXT_PUBLIC_API_URL 파생 후 next 실행
```

세 앱은 배포 시 각각 다른 서브도메인에 올라가며 **쿠키를 공유하지 않는다.** 이 전제를 API 클라이언트 설계에 반영한다 (모든 요청에 `X-App-Id` 헤더로 앱 식별자를 포함).

헬스 조회는 **Server Component 에서 수행한다.** 요청마다 새로 읽어야 하는 값이므로 라우트를 `force-dynamic` 으로 두고 빌드 시점 스냅샷을 굽지 않는다. 클라이언트는 브라우저와 Node 양쪽에서 같은 코드로 동작한다.

Tailwind 는 v4 이므로 설정이 CSS 다. 공통 프리셋도 JS 객체가 아니라 스타일시트이며, 각 앱의 `globals.css` 가 `@import` 로 확장한다.

## 5. 구현 계획

1. `apps/shop` 스캐폴딩 + Tailwind + 설정 연결
2. `packages/shared` 에 API 클라이언트 작성
3. shop 루트 페이지에서 헬스체크 표시
4. seller / admin 을 같은 구조로 생성
5. 포트 분리 및 루트 `dev` 병렬 실행 연결
6. API 다운 상황 처리 확인

## 6. 완료 기준 (Definition of Done)

### 6.1 기능

검증은 `PORT_OFFSET=60`(shop 3060 · seller 3061 · admin 3062 · api 4060) 워크트리에서 수행했다.

| # | 기준 | 측정 방법 | 목표 | 결과 | 충족 |
| --- | --- | --- | --- | --- | --- |
| F1 | 동시 기동 | `pnpm dev` | 4개 프로세스 모두 응답 | api 4060 · shop 3060 · seller 3061 · admin 3062 전부 HTTP 200 | [x] |
| F2 | 상태 표시 | `:3060` · `:3061` · `:3062` 접속 | 응답에 있는 상태 항목 전부 표시 | 세 앱 모두 `전체 상태 정상 / 검색엔진 정상` + 가동시간 · API 버전[^db] | [x] |
| F3 | 장애 시 화면 | API 중지 후 새로고침 | 에러 상태 표시, 페이지 크래시 없음 | 세 앱 모두 HTTP 200 + `API 에 연결하지 못했습니다` | [x] |
| F4 | 공용 타입 사용 | 응답 타입을 `packages/shared` 에서 참조 | `pnpm typecheck` error 0 | `healthResponseSchema` · `HealthResponse` 사용, error 0 | [x] |
| F5 | 앱 독립성 | shop 만 중지 | seller·admin 정상 동작 | shop 000, seller·admin 200, API 정상 | [x] |
| F5b | 포트 오프셋 | `PORT_OFFSET=10 pnpm dev` | 3010/3011/3012 에서 응답, API 연결 정상 | 세 앱 모두 200, 엔드포인트 `http://localhost:4010`, 검색 정상 | [x] |
| F6 | 클린 클론 | 빈 디렉터리에 clone → install → infra up → dev | **수동 수정 0회로 전부 기동** | 임시 디렉터리에 clone(`PORT_OFFSET=10`) 후 4개 전부 4.2초에 기동 | [x] |

[^db]: TASK 작성 시점의 문구는 "API/DB/검색 3개 항목"이었으나, **`database` 항목은 TASK-0005 가 추가한다.** 이 작업 시점의 `/health` 응답은 `status` · `search` · `uptime` · `version` 뿐이므로 상태 항목은 2개(`status`, `search`)가 정상이다. 화면은 항목 이름을 하드코딩하지 않고 **응답에 들어 있는 상태 값을 그대로 렌더**한다(`healthEntries`). `packages/shared` 의 `healthResponseSchema` 에 `database` 가 추가되는 순간 세 앱이 코드 변경 없이 한 줄 더 그린다 — 한국어 라벨 `데이터베이스` 는 세 앱의 메시지 카탈로그에 미리 넣어 두었다. **실제로 확인했다** — 작업 중 `main` 에 TASK-0005 가 머지되었기에, 임시 클론에서 이 브랜치에 `main` 을 병합해 기동해 봤다. `/health` 가 `{"status":"ok","database":"ok","search":"ok",…}` 를 돌려주자 **세 앱 모두 코드 변경 없이 `전체 상태 · 데이터베이스 · 검색엔진` 세 줄을 그렸다.** 병합 충돌은 `pnpm-lock.yaml` 한 건뿐이고(`pnpm install` 로 해소), 병합된 트리에서 `typecheck` · `lint` · `build` · `test` · `format:check` 가 전부 exit 0 이었다.

#### F6 클린 클론 절차 (실제 수행)

```bash
git clone --branch feature/web-bootstrap <저장소>/.bare <임시 디렉터리>
cp .env.example .env                       # README 의 문서화된 준비 단계
printf 'PORT_OFFSET=10\nCOMPOSE_PROJECT_NAME=shopping-wb-offset10\n' > .env.local
pnpm install                               # packages/shared 의 prepare 가 자동 빌드
pnpm infra:up                              # postgres 5442 · meilisearch 7710
pnpm dev                                   # 4개 전부 기동
```

**포트 오프셋을 10 으로 준 것은 작업 중인 워크트리(60)와 충돌을 피하기 위해서다.** 파일을 손으로 고친 곳은 없다 — `.env` 는 `.env.example` 복사본 그대로이고, `.env.local` 은 워크트리마다 만들도록 README 에 문서화된 파일이다. 클론의 작업 트리는 기동 후에도 `git status` 클린이다(생성 파일이 전부 무시된다).

#### 워크트리 병행 동시 기동 (TASK-0001 이월 F6)

위 클린 클론(`PORT_OFFSET=10`)을 띄운 채로 이 워크트리(`PORT_OFFSET=60`)에서 `pnpm dev` 를 추가로 실행했다. **웹 6개 + API 2개가 동시에 정상 기동했고 포트 충돌 0건**(양쪽 로그에 `EADDRINUSE` 없음), docker 스택도 `shopping-wb-offset10` / `shopping-web-bootstrap` 으로 컨테이너·볼륨이 분리되었다.

| 스택 | shop | seller | admin | api | postgres | meilisearch |
| --- | --- | --- | --- | --- | --- | --- |
| 클린 클론 (offset 10) | 3010 ✓ | 3011 ✓ | 3012 ✓ | 4010 ✓ | 5442 | 7710 |
| 이 워크트리 (offset 60) | 3060 ✓ | 3061 ✓ | 3062 ✓ | 4060 ✓ | 5492 | 7760 |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:

- **Q5(커버리지) 면제** — M05 부터 적용
- **Q6~Q7 해당 없음** — TASK-0007 에서 구축
- **2장 화면 게이트 해당 없음** — 확인용 임시 페이지이며 M03 에서 교체된다
- **3~4장(API·데이터) 해당 없음**

### 6.3 성능 · 접근성

확인용 페이지는 사용자 대상 화면이 아니므로 LCP·a11y 기준은 **해당 없음**. M03 부터 적용한다.

| # | 기준 | 측정 방법 | 목표 | 결과 | 충족 |
| --- | --- | --- | --- | --- | --- |
| P1 | 개발 서버 기동 | `pnpm dev` 후 4개 모두 응답까지 | 30초 이내 | **4.3초** (`.next` · `apps/api/dist` 삭제 후 콜드 기동, 마지막 응답까지 4,264ms) | [x] |

### 6.4 문서

| # | 기준 | 결과 | 충족 |
| --- | --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | 이 문서 상태 `완료`. 인덱스 2곳(`docs/tasks/README.md`, `M01-foundation/README.md`)은 오케스트레이터가 갱신 | [x] |
| D3 | `.env.example` 에 웹 앱 변수 반영 | Web apps 절에 `PORT` · `NEXT_PUBLIC_API_URL` 파생 규칙 기재 | [x] |
| D4 | README 에 앱별 포트·실행 방법 기재 | "웹 앱" 절 추가 — 포트표, `--filter` 개별 실행, 구조, 프리셋 | [x] |
| D5 | 확정 버전 기록 | 8장 | [x] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | 앱 3개 병렬 실행 시 개발 머신 부하 | 개별 실행(`--filter`) 방법을 README 에 함께 안내 — 완료 |
| R2 | Tailwind 설정 중복 | 공유 프리셋으로 두고 각 앱은 확장만 — `packages/config/tailwind/preset.css` |
| R3 | **API 의 CORS `allowedHeaders` 에 `X-App-Id` 가 없다** | 이 작업의 헬스 조회는 서버 사이드라 영향이 없지만, **브라우저에서 API 를 직접 호출하는 순간 프리플라이트가 막힌다.** `apps/api` 는 TASK-0005 가 점유 중이라 손대지 않았다. M04(인증) 착수 전에 `apps/api/src/main.ts` 의 `allowedHeaders` 에 `'X-App-Id'` 를 추가해야 한다 |
| R4 | `pnpm -r --parallel` 은 한 스크립트가 0 이 아닌 값으로 끝나면 나머지를 전부 죽인다 | `scripts/web-app.mjs` 가 의도적인 종료(SIGINT·SIGTERM)를 0 으로 보고한다. 그 외 신호·비정상 종료는 그대로 실패로 전달된다 |

## 8. 확정된 버전

| 패키지 | 버전 | 비고 |
| --- | --- | --- |
| next | 16.3.4 | App Router · Turbopack |
| react | 19.2.8 | react-dom 동일 |
| tailwindcss | 4.3.3 | `@tailwindcss/postcss` 4.3.3 |
| @types/react | 19.2.18 | `@types/react-dom` 19.2.5 |
| @types/node | 24.13.3 | TypeScript 6 은 `@types` 를 자동 포함하지 않아 각 앱 tsconfig 의 `types` 에 명시 |

기존에 확정된 버전(변경 없음): Node 24.13.1 · pnpm 9.15.9 · TypeScript 6.0.3 · eslint 10.9.1 · prettier 3.9.6 · zod 4.5.4 · Vitest 4.1.11

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-02 | 승인 — M01 착수 |
| 2026-09-02 | 완료. Next 16 앱 3종 + `packages/shared` API 클라이언트(`X-App-Id`) + Tailwind 공통 프리셋. F1~F6 · P1 전부 충족, 워크트리 병행 동시 기동(TASK-0001 이월) 확인 |
