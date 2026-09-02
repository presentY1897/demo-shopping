# TASK-0001: 워크스페이스 골격

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M01 기반 구축 |
| 상태 | 승인 대기 |
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
- `.gitignore` 보강 (모노레포 산출물)

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
| F1 | 워크스페이스 인식 | `pnpm ls -r --depth -1` | 패키지 7개 출력 | [ ] |
| F2 | 잠금 파일 재현성 | `pnpm install --frozen-lockfile` | 성공 | [ ] |
| F3 | 스크립트 전파 | `pnpm -r exec pwd` | 7개 경로 출력 | [ ] |
| F4 | 패키지 매니저 강제 | `npm install` 시도 | 차단 메시지 후 종료 | [ ] |

### 6.2 품질 게이트

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| Q1 | 설치 경고 | `pnpm install` 출력 | peer dependency 오류 0 | [ ] |
| Q5 | 커버리지 | – | **면제** (코드 없음) | – |

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

## 8. 확정된 버전

| 패키지 | 버전 |
| --- | --- |
| node | |
| pnpm | |

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
