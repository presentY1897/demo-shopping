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

## 문서

- 작업 계획: [`docs/tasks/`](./docs/tasks/)
- 결정 이력: [`docs/decisions/`](./docs/decisions/)
