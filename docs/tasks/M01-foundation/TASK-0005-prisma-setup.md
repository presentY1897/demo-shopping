# TASK-0005: Prisma · DB 연결

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M01 기반 구축 |
| 상태 | 완료 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/prisma-setup` |
| 선행 작업 | TASK-0004 |

## 1. 목적

Prisma 를 연결하고 마이그레이션 파이프라인을 세운다. 이후 모든 스키마 변경이 이 경로를 탄다.

## 2. 범위

### 포함
- Prisma 설치 및 `schema.prisma` 초기화
- `PrismaService` (Nest 라이프사이클에 연결, graceful shutdown)
- 마이그레이션 스크립트: `db:migrate` / `db:reset` / `db:studio`
- 검증용 최소 모델 1개 (예: `AppMeta`) 로 마이그레이션 1회 성공
- `/health` 에 `db` 상태 추가
- 시드 스크립트 골격 (`prisma/seed.mts`) — 내용은 M05

### 제외
- 실제 도메인 스키마 (M04 이후 각 도메인 TASK)
- 시드 데이터 내용 (M05)

## 3. 요구사항

### 기능 요구사항
- [x] `pnpm db:migrate` 로 마이그레이션이 생성·적용된다
- [x] `/health` 가 DB 연결 상태를 반환한다
- [x] DB 가 죽어 있으면 `database: "down"` 을 반환하되 API 는 200 을 유지한다
- [x] 애플리케이션 종료 시 커넥션이 정상적으로 닫힌다
- [x] `pnpm db:reset` 으로 스키마를 초기화하고 재적용할 수 있다

### 비기능 요구사항
- 마이그레이션 파일은 커밋한다. 배포 환경에서는 `migrate deploy` 만 실행한다
- 커넥션 풀 크기를 환경변수로 조절할 수 있게 한다 (서버리스 환경 대비)

## 4. 설계

```
apps/api/
├── prisma.config.mts             Prisma CLI 설정 — DATABASE_URL 을 API 와 같은 코드로 해석
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   │   ├── migration_lock.toml
│   │   └── 20260902144734_init/migration.sql
│   └── seed.mts                  골격만. 내용은 M05
└── src/
    ├── config/database-url.ts    PORT_OFFSET → DATABASE_URL (CLI 와 공유)
    ├── prisma/
    │   ├── prisma.service.ts     PrismaClient 확장 + Nest 라이프사이클
    │   ├── prisma.module.ts      @Global — 프로세스당 풀 1개
    │   └── pool-options.ts       AppConfig → pg 풀 설정
    └── health/database.health-indicator.ts
```

전체 데이터 모델 설계는 `docs/design/erd.md` 참조. 이번 TASK 는 **파이프라인만** 세운다.

### 4.1 DATABASE_URL 을 CLI 와 API 가 공유하는 방법

`DATABASE_URL` 은 `.env` 에 적히지 않고 워크트리의 `PORT_OFFSET` 에서 파생된다(TASK-0004, `scripts/infra.mjs`).
Prisma CLI 는 `AppModule` 을 거치지 않는 별도 프로세스이므로 그대로 두면 마이그레이션과 API 가 **서로 다른 DB** 를 볼 수 있다.

Prisma 7 은 `.env` 를 자동으로 읽지 않고 datasource URL 을 `schema.prisma` 가 아니라 설정 파일에서 받는다.
그래서 `prisma.config.mts` 가 `src/config/database-url.ts` 를 그대로 호출한다 — API 가 부팅 때 쓰는 바로 그 코드다.
시드는 CLI 가 자식 프로세스로 띄우므로 설정 파일이 해석한 값을 `process.env.DATABASE_URL` 에 실어 넘긴다.

### 4.2 커넥션 풀

Prisma 7 은 쿼리 컴파일러 + 드라이버 어댑터 구조라 풀이 `pg` 쪽에 있다.
따라서 `?connection_limit=` 이 아니라 `pg.PoolConfig` 로 조절한다.

| 환경변수 | 기본값 | 범위 | 대응하는 `pg` 옵션 |
| --- | --- | --- | --- |
| `DATABASE_POOL_SIZE` | 10 | 1 ~ 100 | `max` |
| `DATABASE_CONNECT_TIMEOUT_MS` | 5000 | 100 ~ 60000 | `connectionTimeoutMillis` |
| `DATABASE_HEALTH_TIMEOUT_MS` | 1000 | 50 ~ 10000 | (헬스체크 쿼리 데드라인) |

배포 DB 는 Neon 무료(D-060)다. CPU 가 아니라 **커넥션 수**가 천장이므로 풀 크기는 올리는 값이 아니라 내리는 값이다.
`pg` 는 커넥션 획득을 무한정 기다리므로, 오토 서스펜드에서 깨어나는 Neon 을 대비해 획득 시한을 별도로 노출한다.

### 4.3 DB 장애 시 동작

- 부팅 시 `$connect()` 실패는 **경고 후 계속 진행**한다. 부팅 못 하게 막으면 Neon 오토 서스펜드가 배포 실패가 된다.
- `/health` 는 200 을 유지하고 `database: "down"`, `status: "degraded"` 를 보고한다.
- 종료 시 `onApplicationShutdown` 에서 `$disconnect()` 한다 (`main.ts` 의 `enableShutdownHooks()` 로 도달).

## 5. 구현 계획

1. Prisma 설치, `schema.prisma` 초기화, datasource 연결
2. 검증용 모델 1개 정의
3. 첫 마이그레이션 생성·적용
4. `PrismaService` 작성 및 모듈 등록
5. `/health` 에 DB 체크 추가
6. 스크립트 정리, 시드 골격 추가

## 6. 완료 기준 (Definition of Done)

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 결과 | 충족 |
| --- | --- | --- | --- | --- | --- |
| F1 | 마이그레이션 적용 | `pnpm db:migrate` | 성공, `_prisma_migrations` 에 기록 | `20260902144734_init` 적용, `applied_steps_count=1` 조회 확인 | [x] |
| F2 | 헬스체크에 DB 반영 | `curl localhost:4050/api/v1/health` | `database: "ok"` | `{"status":"ok","database":"ok","search":"ok",…}` 200 | [x] |
| F3 | DB 장애 격리 | Postgres 컨테이너만 중지 후 헬스체크 | 200 유지, `database: "down"` | 200 · `{"status":"degraded","database":"down","search":"ok"}` · p95 10.9ms | [x] |
| F4 | 초기화 | `pnpm db:reset --force` 후 `pnpm db:migrate` | 성공 | [x] |
| F5 | 종료 처리 | `kill -TERM` | 커넥션 종료 로그 후 정상 종료 | `[PrismaService] 데이터베이스 커넥션을 닫았습니다. (SIGTERM)` → exit 143, 22ms | [x] |
| F6 | 재현성 | 새 빈 DB 에 `migrate deploy` | 동일 스키마 생성 | 별도 스택(offset 70)에 적용 후 `pg_dump --schema-only` 두 DB 비교 → 동일 | [x] |

> **F4 검증 경위.** Prisma 7 CLI 는 AI 에이전트의 `migrate reset` 실행을 차단한다(우회 환경변수는 사용자의 명시적 동의를 전제로 한 값이라 설정하지 않았다).
> 그래서 이 항목만 **사용자가 직접 실행**했고, 2026-09-03 에 결과를 확인했다.
>
> | 확인 항목 | 값 |
> | --- | --- |
> | 볼륨 `shopping-main_pgdata` 생성 시각 | 2026-09-03 00:46:41 |
> | `_prisma_migrations` 적용 시각 | 2026-09-03 13:23:45 |
> | 행 수 | 1개 (`20260902144734_init`) |
> | `pnpm db:status` | `Database schema is up to date!` |
>
> 볼륨은 그대로인데 마이그레이션 행만 새로 쓰였다 — `db:migrate` 만 돌렸다면 "Already in sync" 로 아무것도 기록하지 않는다. 스키마가 삭제되고 재적용됐다는 뜻이다.

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:

- **Q5(커버리지) 면제** — M05 부터 적용
- **Q6~Q7 해당 없음** — TASK-0007 에서 구축
- **4장 데이터 게이트**: S1(마이그레이션) 적용. S2~S4 는 실제 도메인 스키마부터
- **3장 API 게이트**: A1 적용

실측: `pnpm typecheck` / `pnpm lint` / `pnpm build` / `pnpm test` / `pnpm format:check` 전부 exit 0.
테스트 12파일 65케이스 통과(TASK-0004 대비 +4파일 +22케이스). S1 은 F6 으로 확인.

### 6.3 성능

| # | 기준 | 측정 방법 | 목표 | 결과 | 충족 |
| --- | --- | --- | --- | --- | --- |
| P1 | 헬스체크 응답 | DB 체크 포함 p95 (워밍 10회 후 200회) | 150ms 이하 | p50 1.72ms · **p95 2.21ms** · p99 3.15ms · max 6.08ms | [x] |

### 6.4 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | [ ] 이 문서는 갱신 완료. `docs/tasks/README.md` · `M01-foundation/README.md` 인덱스는 오케스트레이터 담당 |
| D3 | 새 환경변수 `.env.example` 반영 | [x] `DATABASE_POOL_SIZE` · `DATABASE_CONNECT_TIMEOUT_MS` · `DATABASE_HEALTH_TIMEOUT_MS` |
| D5 | 확정 버전 기록 | [x] 8장 |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | 배포 DB(Neon 무료, D-060)의 커넥션 수 제한 | `DATABASE_POOL_SIZE` 로 노출(기본 10). M02 배포 시 실제 값 조정 |
| R2 | `prisma migrate reset` 은 AI 에이전트가 실행할 수 없다 | 로컬 개발 명령이므로 사용자가 직접 실행한다. 비대화형 셸에서는 `pnpm db:reset --force` |
| R3 | `prisma studio` 는 워크트리와 무관하게 5555 를 쓴다 | **해소됨.** `scripts/ports.mjs` 의 `BASE_PORTS` 에 `studio: 5555` 를 추가하고 `--port <service>` 출력 모드를 만들어 `db:studio` 가 오프셋 포트로 뜨게 했다. 오프셋 50 에서 5605 기동 확인 |
| R4 | 저장소 밖으로 `apps/api` 만 복사하면 `prisma.config.mts` 가 URL 을 파생하지 못한다 | 그 경우 `DATABASE_URL` 을 환경변수로 직접 준다. 오류 메시지가 그렇게 안내한다 |

## 8. 확정된 버전

| 패키지 | 버전 | 비고 |
| --- | --- | --- |
| prisma | 7.10.0 | CLI. npm `latest` 태그는 `8.0.0-rc` 를 가리키므로 최신 **정식** 버전으로 고정 |
| @prisma/client | 7.10.0 | |
| @prisma/adapter-pg | 7.10.0 | Prisma 7 은 드라이버 어댑터가 필수다 |
| pg | 8.x | `@prisma/adapter-pg` 의 의존성 |
| PostgreSQL | 17.11 | `docker-compose.yml` |

생성기는 `prisma-client-js` 를 쓴다. `node_modules` 안에 생성되므로 `src/` 를 오염시키지 않고
타입 검사·린트·빌드 대상에서도 벗어난다. `apps/api` 의 `postinstall` 이 `prisma generate` 를 돌린다.

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-02 | 승인 — M01 착수 |
| 2026-09-02 | 시드 골격을 `prisma/seed.ts` → `prisma/seed.mts` 로 변경. Node 24 는 `type: commonjs` 패키지의 `.ts` 를 ESM 으로 감지하지 않아 `import` 구문이 실행되지 않는다 |
| 2026-09-02 | 완료. Prisma 7.10 + pg 드라이버 어댑터로 파이프라인 구축, `/health` 에 `database` 추가, 풀 크기·타임아웃을 환경변수로 노출. F4 는 CLI 의 AI 차단으로 미검증 |
| 2026-09-03 | F4 미충족이므로 상태를 `진행중` 으로 정정. Prisma Studio 포트를 `PORT_OFFSET` 경로로 편입(R3 해소) |
| 2026-09-03 | 사용자가 `db:reset --force` → `db:migrate` 를 직접 실행. F4 충족 확인 후 **완료** |
