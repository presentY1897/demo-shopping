# TASK-001: 모노레포 초기 세팅

| 항목 | 내용 |
| --- | --- |
| 상태 | 승인 대기 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/monorepo-setup` |
| 선행 작업 | 없음 |

## 1. 목적

이후 모든 기능 작업이 올라탈 **개발 기반**을 만든다. 이 작업이 끝나면 명령어 하나로 로컬 개발 환경(웹 + API + DB + 검색엔진)이 뜨고, 품질 게이트(타입 검사·린트·빌드·테스트)가 CI에서 자동으로 돈다.

도메인 기능은 하나도 만들지 않는다. **바닥만 깐다.**

## 2. 범위

### 포함

- pnpm workspace 모노레포 구성 (`apps/`, `packages/`)
- `apps/web` — Next.js (App Router) + TypeScript + Tailwind CSS
- `apps/api` — NestJS + TypeScript
- `packages/shared` — 프론트/백엔드 공용 타입·zod 스키마·상수
- `packages/config` — eslint / prettier / tsconfig 공유 설정
- Prisma 초기화 및 PostgreSQL 연결 (마이그레이션 1회 성공까지)
- `docker-compose.yml` — PostgreSQL + Meilisearch 로컬 개발 환경
- 환경변수 체계 (`.env.example`, 앱별 env 로딩, 부팅 시 스키마 검증)
- 루트 스크립트: `dev` / `build` / `lint` / `typecheck` / `test` / `format`
- Git hook: 커밋 전 lint-staged, 커밋 메시지 Conventional Commits 검증
- GitHub Actions CI: PR 에서 typecheck / lint / build / test 실행
- 헬스체크 엔드포인트 (`GET /health`) 와 이를 호출하는 웹 페이지 1개 — 연결 확인용

### 제외 (이번에 하지 않는 것)

- 상품·주문·회원 등 **도메인 모델과 실제 스키마** (TASK-002 이후)
- 인증 / Google OAuth / 데모 계정 발급 (별도 TASK)
- 디자인 시스템, 컴포넌트 라이브러리 선정 (Q-09)
- Meilisearch 인덱싱 파이프라인 (검색 TASK)
- 실제 배포 (Vercel / Railway 설정은 별도 TASK)
- 토스페이먼츠 연동

## 3. 요구사항

### 기능 요구사항

- [ ] `pnpm install` 후 `docker compose up -d` + `pnpm dev` 만으로 web·api 가 동시에 뜬다
- [ ] `apps/web` 의 확인용 페이지가 `apps/api` 의 `/health` 를 호출해 상태를 표시한다
- [ ] `/health` 는 API 자신, PostgreSQL, Meilisearch 연결 상태를 각각 반환한다
- [ ] `packages/shared` 에 정의한 타입을 web·api 양쪽에서 import 해 쓸 수 있다
- [ ] Prisma 마이그레이션이 실행되고 스키마가 DB 에 반영된다
- [ ] 필수 환경변수가 없으면 **부팅 시점에 명확한 메시지와 함께 실패**한다 (런타임에 undefined 로 흘러가지 않음)

### 비기능 요구사항

- Node 버전을 `.nvmrc` / `engines` 로 고정한다
- 패키지 매니저는 pnpm 으로 고정한다 (`packageManager` 필드)
- 프론트/백엔드 간 타입 중복 정의를 만들지 않는다 — `packages/shared` 가 단일 출처
- 라이브러리 버전은 **설치 시점의 최신 안정 버전**을 사용하고, 확정된 버전을 이 문서 8장에 기록한다

## 4. 설계

### 디렉터리 구조

```
.
├── apps/
│   ├── web/                  # Next.js
│   │   ├── src/app/
│   │   └── next.config.ts
│   └── api/                  # NestJS
│       ├── src/
│       │   ├── health/       # 헬스체크 모듈
│       │   ├── prisma/       # PrismaService
│       │   └── config/       # env 스키마 검증
│       └── prisma/schema.prisma
├── packages/
│   ├── shared/               # 공용 타입 / zod 스키마 / 상수
│   └── config/               # eslint / prettier / tsconfig preset
├── docker-compose.yml
├── pnpm-workspace.yaml
├── .env.example
└── .github/workflows/ci.yml
```

### 로컬 인프라 (docker-compose)

| 서비스 | 포트 | 비고 |
| --- | --- | --- |
| postgres | 5432 | 볼륨으로 데이터 유지 |
| meilisearch | 7700 | 마스터 키는 env 로 주입 |

### 환경변수

| 이름 | 사용처 | 예시 |
| --- | --- | --- |
| `DATABASE_URL` | api | `postgresql://...@localhost:5432/shopping` |
| `MEILI_HOST` | api | `http://localhost:7700` |
| `MEILI_MASTER_KEY` | api, meilisearch | 로컬 개발용 임의 값 |
| `API_PORT` | api | `4000` |
| `NEXT_PUBLIC_API_URL` | web | `http://localhost:4000` |

- API 는 부팅 시 zod 스키마로 env 를 검증한다. 누락 시 프로세스를 종료한다.
- `.env` 는 커밋하지 않는다. `.env.example` 만 커밋한다.

### API / 라우트

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/health` | `{ status, db, search, uptime }` 반환 |

### 화면

| 경로 | 설명 |
| --- | --- |
| `/` | 확인용 임시 페이지. API·DB·검색엔진 연결 상태 표시 |

> 이 페이지는 디자인 대상이 아니며 첫 화면 TASK 에서 교체된다.

### 역할별 권한

해당 없음 (도메인·인증 없음).

## 5. 구현 계획

1. pnpm workspace 골격 (`pnpm-workspace.yaml`, 루트 `package.json`, `.nvmrc`)
2. `packages/config` — tsconfig base, eslint flat config, prettier
3. `packages/shared` — 빌드 설정과 샘플 타입 1개
4. `apps/api` — NestJS 스캐폴딩 + env 검증 + `/health`
5. `docker-compose.yml` 작성 후 postgres·meilisearch 기동 확인
6. Prisma 초기화 → 최소 스키마(예: `HealthCheck`) 로 마이그레이션 1회 성공
7. `/health` 에 DB·Meilisearch 연결 확인 로직 연결
8. `apps/web` — Next.js 스캐폴딩 + Tailwind + `/health` 호출 페이지
9. 루트 스크립트 정리 (`dev` 는 web·api 병렬 실행)
10. Git hook (lint-staged + commitlint)
11. GitHub Actions CI 작성 및 PR 에서 통과 확인
12. `.env.example`, README 개발 환경 절 갱신

> Tailwind 도입은 Q-09(컴포넌트 라이브러리 선정)를 앞당기지 않는다. shadcn/ui 를 쓰든 자체 컴포넌트로 가든 Tailwind 는 공통 전제이므로 여기서 깔아둔다.

## 6. 완료 기준 (Definition of Done)

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 클린 클론에서 개발 환경이 뜬다 | 빈 디렉터리에 clone → `pnpm install` → `docker compose up -d` → `pnpm dev` | 수동 수정 0회로 web·api 기동 | [ ] |
| F2 | 헬스체크가 인프라 상태를 반환한다 | `curl localhost:4000/health` | HTTP 200, `db`·`search` 모두 `ok` | [ ] |
| F3 | 웹이 API 를 호출한다 | 브라우저로 `localhost:3000` 접속 | 세 항목(API/DB/검색) 상태가 화면에 표시 | [ ] |
| F4 | 공용 타입이 양쪽에서 동작한다 | `packages/shared` 타입을 web·api 에서 import 후 `pnpm typecheck` | error 0 | [ ] |
| F5 | Prisma 마이그레이션이 성공한다 | `pnpm prisma migrate dev` | 성공, `_prisma_migrations` 에 기록 | [ ] |
| F6 | env 누락 시 부팅 실패한다 | `DATABASE_URL` 을 지우고 api 기동 | 누락 변수명이 포함된 메시지 출력 후 종료(코드 ≠ 0) | [ ] |
| F7 | 워크스페이스 의존성이 올바르다 | `pnpm install --frozen-lockfile` | 성공 | [ ] |

### 6.2 품질 게이트 (공통)

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| Q1 | 타입 검사 | `pnpm typecheck` | error 0 | [ ] |
| Q2 | 린트 | `pnpm lint` | error 0, warning 0 | [ ] |
| Q3 | 빌드 | `pnpm build` | web·api 모두 성공 | [ ] |
| Q4 | 단위 테스트 | `pnpm test` | 전부 통과 (`/health` 테스트 최소 1개 포함) | [ ] |
| Q5 | 커버리지 | 커버리지 리포트 | 이번 TASK 는 스캐폴딩이므로 **면제**. 기준선만 설정하고 TASK-002 부터 80% 적용 | [ ] |
| Q6 | CI | GitHub Actions PR 실행 | 전 job green | [ ] |
| Q7 | 커밋 규칙 강제 | 규칙 위반 메시지로 커밋 시도 | 훅이 차단 | [ ] |

### 6.3 성능 · 접근성

이번 TASK 는 사용자 대상 화면이 없다(확인용 임시 페이지뿐). **해당 없음** — 첫 화면 TASK 부터 적용한다.

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| P1 | 개발 서버 기동 시간 | `pnpm dev` 실행 후 두 앱 응답까지 | 30초 이내 | [ ] |

### 6.4 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 이 문서 상태 `완료` 로 변경 + `docs/tasks/README.md` 인덱스 갱신 | [ ] |
| D2 | 구현 중 바뀐 결정을 세션 파일과 `DECISIONS.md` 에 반영 | [ ] |
| D3 | `.env.example` 에 전 변수 기재 | [ ] |
| D4 | README 에 로컬 개발 환경 실행 절차 기재 | [ ] |
| D5 | 확정된 라이브러리 버전을 8장에 기록 | [ ] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | Next.js 와 NestJS 의 eslint/tsconfig 요구가 충돌할 수 있음 | `packages/config` 에서 base 를 두고 앱별로 확장. 충돌 시 앱별 override 허용 |
| R2 | WSL2 환경에서 Docker 볼륨 성능·권한 문제 | 볼륨은 named volume 사용, 바인드 마운트 최소화 |
| R3 | pnpm workspace 에서 NestJS 빌드 시 의존성 해석 문제 | `node-linker` 설정으로 대응, 안 되면 해당 앱만 hoist |
| Q-09 | 컴포넌트 라이브러리 선정 | 이번 범위 밖. Tailwind 만 도입하고 선택지를 열어둠 |
| Q-10 | 테스트·CI 범위 | 이번엔 **최소 CI**(typecheck/lint/build/test)만. E2E·커버리지 게이트는 별도 결정 |

## 8. 확정된 버전

구현 시 기록한다.

| 패키지 | 버전 |
| --- | --- |
| node | |
| pnpm | |
| next | |
| @nestjs/core | |
| prisma | |
| meilisearch | |

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
