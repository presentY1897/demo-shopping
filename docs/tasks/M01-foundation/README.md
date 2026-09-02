# M01. 기반 구축

이후 모든 마일스톤이 올라탈 개발 기반을 만든다. 도메인 기능은 하나도 만들지 않는다.

**완료 조건**: 빈 디렉터리에 clone 해서 `pnpm install` → `docker compose up -d` → `pnpm dev` 만으로 API 와 웹 앱 3개가 뜨고, PR 에서 품질 게이트가 자동으로 돈다.

| ID | 제목 | 상태 | 선행 |
| --- | --- | --- | --- |
| [TASK-0001](./TASK-0001-workspace-skeleton.md) | 워크스페이스 골격 | 완료 | – |
| [TASK-0002](./TASK-0002-shared-config.md) | 공유 설정 패키지 | 완료 | 0001 |
| [TASK-0003](./TASK-0003-local-infra.md) | 로컬 인프라 (Docker) | 완료 | 0001 |
| [TASK-0004](./TASK-0004-api-bootstrap.md) | API 부트스트랩 | 완료 | 0002, 0003 |
| [TASK-0005](./TASK-0005-prisma-setup.md) | Prisma · DB 연결 | 진행중 | 0004 |
| [TASK-0006](./TASK-0006-web-bootstrap.md) | 웹 앱 3종 부트스트랩 | 완료 | 0002, 0004 |
| [TASK-0007](./TASK-0007-dev-workflow.md) | 개발 워크플로 · CI | 완료 | 0006 |

```
0001 ─┬─ 0002 ─┬─ 0004 ── 0005
      │        │
      └─ 0003 ─┘     0004 ─┬─ 0006 ── 0007
                            │
                     0002 ──┘
```
