# TASK-0001: 워크스페이스 골격

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M01 기반 구축 |
| 상태 | 완료 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/workspace-skeleton` |
| 선행 작업 | 없음 |

## 1. 목적

pnpm 모노레포의 뼈대를 세운다. 이 작업 후에는 빈 패키지들이 워크스페이스로 인식되고, 루트에서 명령을 하위 패키지에 전파할 수 있다.

## 2. 범위

### 포함
- `pnpm-workspace.yaml` — `apps/*`, `packages/*`
- 루트 `package.json` — `packageManager` 고정, 워크스페이스 스크립트
- `.nvmrc`, `engines` 필드로 Node 버전 고정
- 디렉터리 골격 생성 (`apps/api`, `apps/shop`, `apps/seller`, `apps/admin`, `packages/shared`, `packages/config`, `packages/ui`) — 각각 최소 `package.json` 만
- 루트 스크립트 껍데기: `dev` / `build` / `lint` / `typecheck` / `test` / `format`
- **워크트리별 포트 격리** — `PORT_OFFSET` 환경변수로 전 포트를 일괄 이동
- `.gitignore` 보강 (모노레포 산출물, `.env.local`)

### 제외
- 각 앱·패키지의 실제 내용 (후속 TASK)
- 린트·포맷 설정 내용 (TASK-0002)
- Docker, DB (TASK-0003)

## 3. 요구사항

### 기능 요구사항
- [ ] `pnpm install` 이 성공하고 워크스페이스 7개가 인식된다
- [ ] `pnpm -r exec node -e "console.log(process.cwd())"` 가 모든 패키지에서 실행된다
- [ ] 잘못된 패키지 매니저(npm/yarn)로 설치를 시도하면 차단된다
- [ ] Node 버전이 맞지 않으면 설치 시 경고 또는 실패한다

### 비기능 요구사항
- 패키지 이름은 `@shopping/*` 스코프로 통일한다
- 라이브러리 버전은 설치 시점의 최신 안정 버전을 쓰고 8장에 기록한다
- **여러 워크트리에서 동시에 `pnpm dev` 를 띄워도 충돌하지 않아야 한다**

### 워크트리 포트 격리

이 저장소는 `feature-<name>` 워크트리를 여러 개 두고 병행 작업한다(D-007). 포트가 고정이면 두 번째 워크트리에서 `pnpm dev` 가 실패한다.

`.env.local`(gitignore) 에 오프셋 하나만 지정하면 전 포트가 밀린다.

```
# feature-search 워크트리의 .env.local
PORT_OFFSET=10        →  shop 3010 / seller 3011 / admin 3012 / api 4010
                          postgres 5442 / meilisearch 7710
COMPOSE_PROJECT_NAME=shopping-search    ← 컨테이너·볼륨도 분리
```

`COMPOSE_PROJECT_NAME` 을 분리하는 이유: 같은 이름이면 두 워크트리가 **같은 DB 컨테이너를 공유**한다. 한쪽에서 마이그레이션을 돌리면 다른 쪽 스키마가 바뀐다.

## 4. 설계

```
.
├── apps/
│   ├── api/          @shopping/api
│   ├── shop/         @shopping/shop
│   ├── seller/       @shopping/seller
│   └── admin/        @shopping/admin
├── packages/
│   ├── shared/       @shopping/shared
│   ├── config/       @shopping/config
│   └── ui/           @shopping/ui
├── pnpm-workspace.yaml
├── package.json
└── .nvmrc
```

`dev` 스크립트는 `pnpm -r --parallel dev` 로 두고, 개별 실행은 `pnpm --filter @shopping/shop dev` 를 쓴다.

## 5. 구현 계획

1. 루트 `package.json` + `pnpm-workspace.yaml`
2. `.nvmrc`, `engines`, `packageManager`, `only-allow` 로 pnpm 강제
3. 7개 패키지 디렉터리와 최소 `package.json`
4. 루트 스크립트 연결
5. `.gitignore` 보강

## 6. 완료 기준 (Definition of Done)

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 워크스페이스 인식 | `pnpm ls -r --depth -1` | 패키지 7개 출력 | [x] |
| F2 | 잠금 파일 재현성 | `pnpm install --frozen-lockfile` | 성공 | [x] |
| F3 | 스크립트 전파 | `pnpm -r exec pwd` | 7개 경로 출력 | [x] |
| F4 | 패키지 매니저 강제 | `npm install` 시도 | 차단 메시지 후 종료 코드 1 | [x] |
| F5 | 포트 오프셋 | `PORT_OFFSET=10 pnpm ports --json` | 전 포트가 +10 으로 이동 | [x] |
| F6 | 워크트리 병행 (포트 배분) | 서로 다른 오프셋 두 개로 `pnpm ports --json` | 두 포트 집합의 교집합 0개 | [x] |

> **F6 범위 조정** — 최초 계획은 "두 워크트리에서 동시에 `pnpm dev`" 였으나, 이 TASK 시점에는 `dev` 스크립트를 가진 앱이 하나도 없어 검증이 불가능하다.
> 여기서는 **포트 배분 규칙이 워크트리끼리 겹치지 않는다**는 것까지 검증하고, 실제 동시 기동은 앱이 생기는 **TASK-0006 (F5b·F6)** 에서 확인한다.

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:

- **Q1~Q4 해당 없음** — 아직 소스 코드가 없다. `pnpm install` 성공과 워크스페이스 인식이 검증 대상
- **Q5(커버리지) 면제** — M05 부터 적용
- **Q6~Q7 해당 없음** — CI·커밋 훅은 TASK-0007 에서 구축
- **3~4장(API·데이터) 해당 없음**

### 6.3 성능 · 접근성

**해당 없음** — 화면·API 없음.

### 6.4 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 `완료` 로 변경 + 인덱스 2곳 갱신 | [ ] |
| D5 | 확정 버전을 8장에 기록 | [ ] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | WSL2 에서 pnpm 심볼릭 링크 권한 문제 | 발생 시 `node-linker=hoisted` 로 전환 검토 |
| R2 | 워크트리를 늘릴수록 Docker 컨테이너·볼륨이 쌓임 | `pnpm infra:down --volumes` 로 정리. 워크트리 제거 시 함께 정리하도록 README 에 안내 |

## 8. 확정된 버전

| 패키지 | 버전 |
| --- | --- |
| node | 24.13.1 (`.nvmrc`, `engines: >=24.13.0 <25`) |
| pnpm | 9.15.9 (`packageManager`, `engines: >=9.15.0 <10`) |

런타임 의존성은 아직 없다. `pnpm-lock.yaml` 은 워크스페이스 7개만 기록한 상태로 커밋한다.

### 이 TASK 가 만든 스크립트

| 파일 | 역할 |
| --- | --- |
| `scripts/only-pnpm.mjs` | `preinstall` 훅. `npm_config_user_agent` 로 pnpm 이 아니면 종료. 외부 의존성 없이 동작해야 하므로 `npx only-allow` 를 쓰지 않는다 |
| `scripts/ports.mjs` | 전 포트의 단일 출처. `BASE_PORTS` + `PORT_OFFSET`. 다른 스크립트에서 `portFor('api')` 로 import 한다 |

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-02 | 승인 — M01 착수 |
| 2026-09-02 | 완료. F6 을 포트 배분 검증으로 한정하고 동시 기동 검증은 TASK-0006 으로 이관 |
