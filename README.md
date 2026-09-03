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

**복사한 뒤 고칠 것은 없다.** `DATABASE_URL` · `MEILI_HOST` · `API_PORT` · `CORS_ORIGINS` 는 `.env` 에 없으면
API 가 부팅 시 `PORT_OFFSET` 에서 계산해 채운다. 명시하면 그 값이 그대로 쓰이므로, 로컬 스택이 아닌 곳
(Neon, 원격 검색 서버)을 가리킬 때만 주석을 풀면 된다. 실제 포트는 `pnpm ports` 로 확인할 수 있다.

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

## API

```bash
pnpm --filter @shopping/api dev     # 4000 + PORT_OFFSET 에서 기동
curl localhost:4000/api/v1/health   # {"status":"ok","search":"ok","uptime":3,"version":"0.0.0"}
```

| 항목 | 값 |
| --- | --- |
| 프레임워크 | NestJS 12 (Express) |
| 프리픽스 | `/api/v1` — 버전은 URI 방식, 라우트가 생략하면 `v1` |
| 헬스체크 | `GET /api/v1/health` → `{ status, search, uptime, version }` |
| 에러 포맷 | `{ "error": { "code", "message", "details": [] } }` — 성공 응답은 감싸지 않는다 |
| CORS | `CORS_ORIGINS` 의 오리진만 허용. 기본값은 shop·seller·admin 세 앱 |
| 로그 | 모든 요청에 `X-Request-Id` 부여 후 `메서드 경로 상태 소요시간 요청ID` 로 기록 |

- 환경변수는 **부팅 시점에 zod 로 검증**한다. 누락·형식 오류면 변수명을 출력하고 종료 코드 1 로 끝난다.
  값은 절대 출력하지 않는다.
- 검색 엔진이 죽어도 헬스체크는 **200 을 유지**하고 `search: "down"`, `status: "degraded"` 를 반환한다.
  API 자체는 살아 있으므로 로드밸런서가 인스턴스를 빼면 안 된다.
- 스택 트레이스는 `NODE_ENV=development` 에서 5xx 응답에만 들어간다.

```bash
pnpm --filter @shopping/api build   # dist/ 로 컴파일
pnpm --filter @shopping/api start   # 컴파일된 결과 실행
pnpm --filter @shopping/api test    # vitest
```

## 데이터베이스

Prisma 명령은 저장소 루트에서 실행한다. `DATABASE_URL` 은 이 워크트리의 `PORT_OFFSET` 에서
파생되므로 따로 설정할 것이 없다. 먼저 `pnpm infra:up` 으로 Postgres 가 떠 있어야 한다.

| 명령 | 설명 |
| --- | --- |
| `pnpm db:migrate` | 스키마 변경을 마이그레이션으로 만들고 적용 (개발) |
| `pnpm db:deploy` | 이미 만들어진 마이그레이션만 적용 (배포) |
| `pnpm db:status` | 적용 상태 확인 |
| `pnpm db:reset` | DB 를 비우고 처음부터 재적용 — **데이터가 사라진다** |
| `pnpm db:seed` | 시드 실행 (내용은 M05 부터) |
| `pnpm db:studio` | Prisma Studio. 포트는 `5555 + PORT_OFFSET` |
| `pnpm db:generate` | Prisma Client 재생성 (`pnpm install` 이 자동으로 한다) |

`db:reset` 은 확인 프롬프트를 띄운다. 비대화형 셸에서는 `pnpm db:reset --force`.
마이그레이션 SQL 은 커밋한다. 배포 환경에서는 `db:deploy` 만 돈다.

## 웹 앱 (shop / seller / admin)

구매자·판매자·관리자를 **독립된 Next.js 앱 3개**로 띄운다. 세션도 앱별로 독립이다(쿠키에 `Domain` 미지정).

```bash
pnpm dev                              # API + 웹 3개를 한 번에 (아래 표의 포트)
pnpm --filter @shopping/shop dev      # 필요한 앱만 따로
pnpm --filter @shopping/seller dev
pnpm --filter @shopping/admin dev
```

| 앱 | 패키지 | 포트 | 대상 |
| --- | --- | --- | --- |
| `apps/shop` | `@shopping/shop` | 3000 + `PORT_OFFSET` | 구매자 |
| `apps/seller` | `@shopping/seller` | 3001 + `PORT_OFFSET` | 판매자 |
| `apps/admin` | `@shopping/admin` | 3002 + `PORT_OFFSET` | 관리자 |

앱 3개를 동시에 띄우면 개발 머신이 버거울 수 있다. **`--filter` 로 필요한 앱만 띄우는 쪽이 기본**이고,
`pnpm dev` 는 네 프로세스를 한 번에 확인할 때 쓴다. 한 앱을 Ctrl+C 로 멈춰도 나머지는 계속 돈다.

각 앱의 `dev` / `build` / `start` 는 `scripts/web-app.mjs` 를 거친다. Next 는 설정 파일을 읽기 전에
포트를 정하므로 `next.config.ts` 에서는 늦다. 이 래퍼가 `scripts/ports.mjs` 에서 두 값을 계산해 넘긴다.

| 변수 | 파생 규칙 |
| --- | --- |
| `PORT` | 앱별 기본 포트 + `PORT_OFFSET` |
| `NEXT_PUBLIC_API_URL` | `http://localhost:(4000 + PORT_OFFSET)` |

셸에 이미 있는 값이 이긴다 — 배포 플랫폼이 주입한 `PORT` 가 그대로 쓰이고,
`PORT_OFFSET=10 pnpm dev` 는 파일 수정 없이 3010·3011·3012·4010 으로 옮겨 준다.

> `NEXT_PUBLIC_*` 은 **빌드 시점에 페이지에 박힌다.** 비밀값을 넣으면 안 되고,
> `PORT_OFFSET` 을 바꾼 뒤 `pnpm start` 로 확인하려면 다시 빌드해야 한다. `pnpm dev` 는 재시작만 하면 된다.

### 구조

```
apps/shop/src/
├── app/          App Router — layout.tsx / page.tsx / globals.css
├── components/   이 앱 전용 컴포넌트
├── lib/          api.ts (이 앱의 API 클라이언트) · health.ts
└── messages/     UI 문구. ko.ts 가 유일한 카탈로그이고 컴포넌트는 types.ts 만 본다
```

- **API 클라이언트는 `packages/shared/src/api` 하나뿐이다.** 각 앱은 자기 `AppId` 로 인스턴스만 만든다.
  모든 요청에 `X-App-Id` 가 실리므로, 쿠키를 공유하지 않는 세 앱을 API 가 구분할 수 있다.
- **UI 문구는 하드코딩하지 않는다.** 한국어 카탈로그(`messages/ko.ts`)만 있고 다국어는 구조만 잡혀 있다.
- Tailwind 는 v4(CSS 우선 설정)다. 공통 프리셋 `@shopping/config/tailwind/preset.css` 를 세 앱이 확장한다.
  디자인 토큰과 밀도 3단계는 M03 에 이 프리셋으로 들어온다.
- 루트 페이지는 **기동 확인용 임시 화면**이다. `/health` 응답에 들어 있는 상태 항목을 그대로 그리므로
  API 에 항목이 늘면 화면도 따라 늘어난다. M03 에서 실제 화면으로 교체된다.

```bash
pnpm --filter @shopping/shop build    # .next 로 프로덕션 빌드
pnpm --filter @shopping/shop start    # 빌드 결과 실행
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

### 포트가 들어가는 값은 적지 않는다

아래 네 개는 `.env` 에 **없을 때** API 가 `PORT_OFFSET` 에서 계산한다. 워크트리마다 손으로 고칠 것이 없다는 뜻이다.

| 변수 | 파생 규칙 |
| --- | --- |
| `API_PORT` | `4000 + PORT_OFFSET`. 없으면 `PORT`(Render·Railway 가 주입) 를 먼저 본다 |
| `MEILI_HOST` | `http://localhost:(7700 + PORT_OFFSET)` |
| `DATABASE_URL` | `postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@localhost:(5432 + PORT_OFFSET)/$POSTGRES_DB` |
| `CORS_ORIGINS` | shop·seller·admin 오리진 (`localhost` 와 `127.0.0.1` 양쪽) |

웹 앱 3개의 `PORT` 와 `NEXT_PUBLIC_API_URL` 도 같은 방식으로 `scripts/web-app.mjs` 가 채운다.

`scripts/ports.mjs` 가 단일 출처이며, API 는 이 파일을 런타임에 읽는다. 기본 포트를 바꿀 일이 생기면 그 파일만 고치면 된다.

```bash
PORT_OFFSET=50 pnpm --filter @shopping/api dev   # 파일 수정 없이 4050 에서 기동
```

**명시한 값이 항상 이긴다.** 배포 환경처럼 워크스페이스도 `.env` 도 없는 곳에서는 파생이 동작하지 않으므로
플랫폼이 전부 주입해야 하고, 빠진 변수는 부팅 시 검증에서 이름과 함께 보고된다.

## 개발 워크플로

### 품질 게이트

| 명령 | 검사 |
| --- | --- |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | eslint — **루트 파일 먼저, 그 다음 패키지 7개** |
| `pnpm format:check` | prettier — 루트에서 한 번에 저장소 전체 |
| `pnpm build` | 전 패키지 빌드 |
| `pnpm test` | vitest |

`pnpm -r` 은 **루트 프로젝트를 건너뛴다.** 그래서 `scripts/*.mjs` 와 루트 설정 파일은
패키지 스크립트로는 영원히 검사되지 않는다. lint 는 루트 검사(`pnpm lint:root`)를 먼저
돌리고, format 은 아예 루트 한 번으로 저장소 전체를 본다.

마크다운은 prettier 대상에서 뺐다(`.prettierignore`). 표를 CJK 폭 기준으로 다시 정렬하고
문서 안의 코드 예제까지 다시 쓰기 때문에, 포맷이 아니라 문서 수정이 되어 버린다.

`typecheck` · `lint` · `test` 는 **`packages/shared/dist` 가 있어야** 통과한다.
`pnpm install` 이 그 패키지의 `prepare` 훅으로 만들어 주지만, 지웠다면 다시 만든다.

```bash
pnpm --filter @shopping/shared build
```

### 커밋 훅

| 훅 | 하는 일 | 도구 |
| --- | --- | --- |
| `pre-commit` | 스테이징된 파일만 `eslint --fix` → `prettier --write` | lint-staged |
| `commit-msg` | Conventional Commits 형식 검증 | commitlint |

- 훅은 **변경된 파일만** 본다. 저장소가 커져도 커밋이 느려지지 않는다. 전체 검사는 CI 몫이다.
- 포맷이 어긋난 파일은 훅이 **고쳐서 다시 스테이징**하므로 그대로 커밋된다.
  자동으로 못 고치는 린트 오류(미사용 변수 등)는 파일·줄 번호를 출력하고 커밋을 중단한다.
- 훅은 `pnpm install` 이 설치한다(루트 `prepare: husky`). **새 워크트리를 만들면
  `pnpm install` 을 한 번 돌려야** 훅이 붙는다.

### 커밋 메시지

[Conventional Commits](https://www.conventionalcommits.org/). 타입은 8개만 허용한다 —
`feat` `fix` `docs` `chore` `refactor` `test` `style` `perf` (CLAUDE.md 3장과 동일).
`ci` · `build` · `revert` 는 쓰지 않는다. CI 작업도 `chore` 다.

```
chore(ci): PR 에서 typecheck · lint · build · test 병렬 실행

본문은 한국어로, 무엇을 왜 바꿨는지 적는다.
```

### 훅 우회

```bash
git commit --no-verify -m "..."    # 이 커밋만
HUSKY=0 git commit -m "..."        # 이 커밋만 (환경변수 방식)
HUSKY=0 git rebase -i main         # 커밋을 여러 개 다시 쓰는 명령 전체
```

rebase·cherry-pick 은 커밋마다 훅을 돌리므로 `HUSKY=0` 쪽이 편하다.
우회하더라도 **PR 에서 같은 검사가 다시 돈다.** 결국 고쳐야 하므로, 우회는 중간 커밋을
정리하는 동안만 쓴다.

### CI

PR 을 올리면 `.github/workflows/ci.yml` 이 4개 job 을 **병렬로** 돌린다.

| job | 명령 |
| --- | --- |
| `typecheck` | `pnpm typecheck` |
| `lint` | `pnpm lint` + `pnpm format:check` |
| `build` | `pnpm build` |
| `test` | `pnpm test` |

- 네 job 은 서로 의존하지 않는다. 각 job 이 `.github/actions/setup` 으로
  **install → `packages/shared` 빌드**까지 스스로 마친 뒤 자기 명령을 돌린다.
  빌드 산출물을 job 사이에 공유하려면 앞단에 build job 을 하나 둬야 하는데,
  그러면 병렬 이득이 사라진다.
- pnpm store 는 `actions/setup-node` 의 `cache: pnpm` 이 `pnpm-lock.yaml` 해시를
  키로 캐시한다. 잠금 파일이 그대로면 두 번째 실행부터 패키지를 내려받지 않는다.
CI 는 **PR 과 `main` push 양쪽**에서 돈다. rebase 머지는 커밋을 다시 쓰므로 PR 이 검사한
SHA 와 `main` 에 올라간 SHA 가 다르다. 그래서 `main` 에서도 한 번 더 돈다.

### 브랜치 보호

`main` 은 **보호된 브랜치다. 직접 push 할 수 없다**(관리자 포함).

```bash
git rebase main && git push -u origin feature/<name>
gh pr create --fill
gh pr checks --watch
gh pr merge --rebase --delete-branch
```

머지는 **rebase 만** 허용된다(squash·merge commit 은 껐다). 4개 job 이 green 이어야
머지 버튼이 열리고, PR 브랜치는 `main` 기준 최신이어야 한다.
자세한 내용은 [`docs/branch-protection.md`](./docs/branch-protection.md).

## 문서

- 작업 계획: [`docs/tasks/`](./docs/tasks/)
- 결정 이력: [`docs/decisions/`](./docs/decisions/)
