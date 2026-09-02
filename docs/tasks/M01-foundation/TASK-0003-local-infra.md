# TASK-0003: 로컬 인프라 (Docker)

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M01 기반 구축 |
| 상태 | 완료 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/local-infra` |
| 선행 작업 | TASK-0001 |

## 1. 목적

명령 하나로 PostgreSQL 과 Meilisearch 가 뜨는 로컬 개발 환경을 만들고, 환경변수 관리 규약을 정한다.

## 2. 범위

### 포함
- `docker-compose.yml` — PostgreSQL, Meilisearch (named volume 사용)
- `.env.example` — 전 변수 목록과 로컬 기본값
- 환경변수 로딩 규약 (앱별 `.env` 위치와 우선순위)
- 인프라 스크립트 — `docker compose` 명령을 감싼 단축 명령

  | 스크립트 | 하는 일 |
  | --- | --- |
  | `pnpm infra:up` | `docker compose up -d` — Postgres·Meilisearch 백그라운드 기동 |
  | `pnpm infra:down` | 컨테이너 중지·제거 (볼륨은 유지 → 데이터 보존) |
  | `pnpm infra:reset` | 볼륨까지 삭제 후 재기동 (완전 초기화) |
  | `pnpm infra:logs` | 두 컨테이너 로그 확인 |
  | `pnpm infra:ps` | 기동 상태·헬스체크 확인 |

  긴 docker 명령을 외우지 않게 하고, 워크트리별 `COMPOSE_PROJECT_NAME` 을 스크립트가 자동으로 적용하게 하는 것이 목적이다.
- README 에 로컬 환경 실행 절차

### 제외
- 애플리케이션의 env 검증 코드 (TASK-0004)
- Prisma 마이그레이션 (TASK-0005)
- 배포 환경 변수 (M02)

## 3. 요구사항

### 기능 요구사항
- [x] `docker compose up -d` 로 두 서비스가 뜨고 헬스체크를 통과한다
- [x] 컨테이너를 재시작해도 DB 데이터가 유지된다
- [x] `infra:reset` 으로 볼륨까지 초기화할 수 있다
- [x] Meilisearch 가 마스터 키로 보호되고, 키 없이 접근하면 거부된다

### 비기능 요구사항
- WSL2 환경을 고려해 바인드 마운트 대신 named volume 을 쓴다
- 포트 충돌 시 변경할 수 있도록 포트를 환경변수로 노출한다

## 4. 설계

| 서비스 | 이미지 | 포트 | 볼륨 |
| --- | --- | --- | --- |
| postgres | `postgres:17.11-alpine` | `5432 + PORT_OFFSET` | `<project>_pgdata` |
| meilisearch | `getmeili/meilisearch:v1.24.0` | `7700 + PORT_OFFSET` | `<project>_meilidata` |

볼륨 이름은 compose 가 `COMPOSE_PROJECT_NAME` 을 접두어로 붙인다. 포트는 `scripts/ports.mjs` 의 `resolvePorts()` 가 유일한 출처이고,
`scripts/infra.mjs` 가 그 값을 `POSTGRES_PORT` / `MEILI_PORT` 로 compose 에 넘긴다. compose 파일에 포트를 다시 적지 않는다.

**워크트리 격리**: `COMPOSE_PROJECT_NAME` 을 워크트리별로 다르게 두어 컨테이너·볼륨·네트워크를 분리한다. 같은 이름이면 두 워크트리가 같은 DB 를 공유해 마이그레이션이 서로를 덮어쓴다.

### 환경변수

| 이름 | 사용처 | 로컬 기본값 |
| --- | --- | --- |
| `POSTGRES_USER` | docker compose | `shopping` |
| `POSTGRES_PASSWORD` | docker compose | `shopping` |
| `POSTGRES_DB` | docker compose | `shopping` |
| `DATABASE_URL` | api | `postgresql://shopping:shopping@localhost:5432/shopping` |
| `MEILI_HOST` | api | `http://localhost:7700` |
| `MEILI_MASTER_KEY` | api, meilisearch | 로컬 개발용 임의 문자열 |
| `MEILI_ENV` | meilisearch | `development` |
| `API_PORT` | api | `4000` |
| `NEXT_PUBLIC_API_URL` | shop/seller/admin | `http://localhost:4000` |

기본값은 `PORT_OFFSET=0` 기준이다. 오프셋이 있는 워크트리는 `pnpm ports` 또는 `pnpm infra:up` 이 출력하는 값으로 `.env` 를 맞춘다.

#### 로딩 규약

| 파일 | 커밋 | 담는 것 |
| --- | --- | --- |
| `.env.example` | O | 전 변수 목록과 로컬 기본값. 템플릿이며 실제 비밀값을 넣지 않는다 |
| `.env` | X | 이 머신의 실제 로컬 값. `docker compose` 와 앱이 함께 쓴다 |
| `.env.local` | X | 워크트리별 값만 — `PORT_OFFSET`, `COMPOSE_PROJECT_NAME` |

우선순위는 **셸 > `.env.local` > `.env`** 다. `process.loadEnvFile()` 은 이미 설정된 값을 덮어쓰지 않으므로,
먼저 읽은 파일과 셸 값이 이긴다. 덕분에 `PORT_OFFSET=40 COMPOSE_PROJECT_NAME=x pnpm infra:up` 으로
파일을 고치지 않고 두 번째 스택을 띄울 수 있다.

`.env` 는 커밋하지 않는다. `.env.example` 만 커밋한다.

## 5. 구현 계획

1. `docker-compose.yml` 작성 (healthcheck 포함)
2. `.env.example` 작성
3. `scripts/infra.mjs` 로 `infra:*` 스크립트 추가 — Node 내장 모듈만 사용해 새 의존성을 만들지 않는다
4. 기동·재시작·초기화 시나리오 검증
5. README 갱신

## 6. 완료 기준 (Definition of Done)

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 기동 | `pnpm infra:up` 후 `pnpm infra:ps` | 두 서비스 모두 healthy | [x] |
| F2 | DB 접속 | `psql $DATABASE_URL -c 'select 1'` | 1 반환 | [x] |
| F3 | 검색엔진 접속 | `curl -H "Authorization: Bearer $MEILI_MASTER_KEY" $MEILI_HOST/health` | `{"status":"available"}` | [x] |
| F4 | 인증 강제 | 키 없이 `curl $MEILI_HOST/indexes` | 401 | [x] |
| F5 | 데이터 영속 | 테이블 생성 → `docker compose restart` → 조회 | 데이터 유지 | [x] |
| F6 | 초기화 | `pnpm infra:reset` 후 조회 | 볼륨 삭제되어 초기 상태 | [x] |
| F7 | 워크트리 격리 | `PORT_OFFSET`·`COMPOSE_PROJECT_NAME` 을 달리해 두 스택 동시 기동 | 컨테이너·볼륨 분리, 데이터 독립 | [x] |

검증 메모 (`PORT_OFFSET=30`, `COMPOSE_PROJECT_NAME=shopping-local-infra` 워크트리에서 실행):

- **F3 · F4** — 이 워크트리의 `MEILI_HOST` 는 `http://localhost:7730` 이다. F4 응답 본문은 `missing_authorization_header` 였다.
- **F2** — 호스트에 `psql` 이 없어 `docker run --rm --network host postgres:17.11-alpine psql "$DATABASE_URL" -c 'select 1'` 로 대체했다. 컨테이너 안이 아니라 **게시된 호스트 포트 5462** 로 접속하므로 포트 매핑까지 함께 검증된다.
- **F5** — Postgres 테이블과 Meilisearch 인덱스를 각각 만들고 `docker compose restart` 후 둘 다 남아 있는 것을 확인했다. `pnpm infra:down` → `pnpm infra:up` 후에도 유지되는 것을 별도로 확인했다.
- **F7** — 워크트리를 새로 만들 수 없어 같은 워크트리에서 `PORT_OFFSET=40 COMPOSE_PROJECT_NAME=shopping-isolation-test pnpm infra:up` 으로 두 번째 스택을 띄웠다. 컨테이너 4개가 동시에 healthy, 볼륨 4개가 분리, 한쪽에만 있는 테이블·인덱스가 다른 쪽에서 조회되지 않음을 확인한 뒤 테스트 스택은 볼륨까지 삭제했다.

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:

- **Q1~Q4 해당 없음** — 인프라 설정. `docker compose config` 검증으로 대체 (통과)
- **Q5(커버리지) 면제** — M05 부터 적용
- **Q6~Q7 해당 없음** — TASK-0007 에서 구축
- **3~4장(API·데이터) 해당 없음**

### 6.3 성능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| P1 | 기동 시간 | `up -d --wait` 부터 healthy 까지 | 30초 이내 | [x] |

실측: 볼륨이 없는 최초 기동(initdb 포함) **14.2초**, 볼륨이 있는 재기동 **8.1초**. 이미지는 사전 pull 된 상태 기준이다.

### 6.4 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D3 | `.env.example` 에 전 변수 기재 | [x] |
| D4 | README 에 실행 절차 기재 | [x] |
| D1 | 상태 갱신 + 인덱스 2곳 | [x] (상태·본문 갱신 완료. `docs/tasks/README.md` 와 마일스톤 `README.md` 인덱스는 머지 시점에 갱신) |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | WSL2 Docker 볼륨 성능·권한 | named volume 사용, 문제 시 Docker Desktop WSL 통합 설정 확인 |
| R2 | 로컬 포트 충돌 (5432 등) | 포트를 환경변수로 노출해 변경 가능하게 |

## 8. 확정된 버전

| 이미지 | 버전 | 확인 방법 |
| --- | --- | --- |
| postgres | `postgres:17.11-alpine` | `postgres --version` → `postgres (PostgreSQL) 17.11` |
| meilisearch | `getmeili/meilisearch:v1.24.0` | `meilisearch --version` → `meilisearch 1.24.0` |

major 17 을 고른 이유: 배포 DB 가 Neon(DECISIONS D-060)이고 Neon 의 현재 기본 major 가 17 이라 로컬과 배포의 major 를 맞췄다.
태그는 패치까지 고정한다 — `17-alpine` 처럼 움직이는 태그를 쓰면 어느 날 조용히 major 안에서 패치가 바뀐다.

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-02 | 승인 — M01 착수 |
| 2026-09-02 | 완료. docker-compose(Postgres 17.11 + Meilisearch 1.24.0) · `.env.example` · `scripts/infra.mjs` 기반 `infra:*` 5종 · README 절차 추가, F1~F7·P1 실측 검증 |
