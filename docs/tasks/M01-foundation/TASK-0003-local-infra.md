# TASK-0003: 로컬 인프라 (Docker)

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M01 기반 구축 |
| 상태 | 승인 대기 |
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
- [ ] `docker compose up -d` 로 두 서비스가 뜨고 헬스체크를 통과한다
- [ ] 컨테이너를 재시작해도 DB 데이터가 유지된다
- [ ] `infra:reset` 으로 볼륨까지 초기화할 수 있다
- [ ] Meilisearch 가 마스터 키로 보호되고, 키 없이 접근하면 거부된다

### 비기능 요구사항
- WSL2 환경을 고려해 바인드 마운트 대신 named volume 을 쓴다
- 포트 충돌 시 변경할 수 있도록 포트를 환경변수로 노출한다

## 4. 설계

| 서비스 | 이미지 | 포트 | 볼륨 |
| --- | --- | --- | --- |
| postgres | `postgres:<major>-alpine` | `5432 + PORT_OFFSET` | `pgdata` |
| meilisearch | `getmeili/meilisearch:<ver>` | `7700 + PORT_OFFSET` | `meilidata` |

**워크트리 격리**: `COMPOSE_PROJECT_NAME` 을 워크트리별로 다르게 두어 컨테이너·볼륨·네트워크를 분리한다. 같은 이름이면 두 워크트리가 같은 DB 를 공유해 마이그레이션이 서로를 덮어쓴다.

### 환경변수

| 이름 | 사용처 | 로컬 기본값 |
| --- | --- | --- |
| `DATABASE_URL` | api | `postgresql://shopping:shopping@localhost:5432/shopping` |
| `MEILI_HOST` | api | `http://localhost:7700` |
| `MEILI_MASTER_KEY` | api, meilisearch | 로컬 개발용 임의 문자열 |
| `API_PORT` | api | `4000` |
| `NEXT_PUBLIC_API_URL` | shop/seller/admin | `http://localhost:4000` |

`.env` 는 커밋하지 않는다. `.env.example` 만 커밋한다.

## 5. 구현 계획

1. `docker-compose.yml` 작성 (healthcheck 포함)
2. `.env.example` 작성
3. `infra:*` 스크립트 추가
4. 기동·재시작·초기화 시나리오 검증
5. README 갱신

## 6. 완료 기준 (Definition of Done)

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 기동 | `docker compose up -d` 후 `docker compose ps` | 두 서비스 모두 healthy | [ ] |
| F2 | DB 접속 | `psql $DATABASE_URL -c 'select 1'` | 1 반환 | [ ] |
| F3 | 검색엔진 접속 | `curl -H "Authorization: Bearer $MEILI_MASTER_KEY" localhost:7700/health` | `{"status":"available"}` | [ ] |
| F4 | 인증 강제 | 키 없이 `curl localhost:7700/indexes` | 401 | [ ] |
| F5 | 데이터 영속 | 테이블 생성 → `docker compose restart` → 조회 | 데이터 유지 | [ ] |
| F6 | 초기화 | `pnpm infra:reset` 후 조회 | 볼륨 삭제되어 초기 상태 | [ ] |
| F7 | 워크트리 격리 | 두 워크트리에서 각각 `infra:up` | 컨테이너·볼륨 분리, 데이터 독립 | [ ] |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:

- **Q1~Q4 해당 없음** — 인프라 설정. `docker compose config` 검증으로 대체
- **Q5(커버리지) 면제** — M05 부터 적용
- **Q6~Q7 해당 없음** — TASK-0007 에서 구축
- **3~4장(API·데이터) 해당 없음**

### 6.3 성능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| P1 | 기동 시간 | `up -d` 부터 healthy 까지 | 30초 이내 | [ ] |

### 6.4 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D3 | `.env.example` 에 전 변수 기재 | [ ] |
| D4 | README 에 실행 절차 기재 | [ ] |
| D1 | 상태 갱신 + 인덱스 2곳 | [ ] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | WSL2 Docker 볼륨 성능·권한 | named volume 사용, 문제 시 Docker Desktop WSL 통합 설정 확인 |
| R2 | 로컬 포트 충돌 (5432 등) | 포트를 환경변수로 노출해 변경 가능하게 |

## 8. 확정된 버전

| 이미지 | 버전 |
| --- | --- |
| postgres | |
| meilisearch | |

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
