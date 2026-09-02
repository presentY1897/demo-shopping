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

`PORT_OFFSET` 이 0 이 아니면 `.env` 안의 `DATABASE_URL` · `MEILI_HOST` · `API_PORT` · `NEXT_PUBLIC_API_URL` 포트를
이 워크트리 값으로 바꾼다. 실제 값은 `pnpm ports` 로 확인하거나, `pnpm infra:up` 이 마지막에 출력하는 안내를 그대로 복사하면 된다.

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

## 문서

- 작업 계획: [`docs/tasks/`](./docs/tasks/)
- 결정 이력: [`docs/decisions/`](./docs/decisions/)
