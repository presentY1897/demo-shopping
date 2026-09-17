# 로컬 실행

클론한 저장소 루트에서 실행한다. 개발자의 bare/worktree 배치를 그대로 만들 필요는 없다.
Node.js 24와 pnpm 9.15, 실행 중인 Docker 및 Compose 플러그인이 필요하다.

## 새 환경 설정

```bash
pnpm install --frozen-lockfile
cp .env.example .env
node -e 'const fs = require("node:fs"); const crypto = require("node:crypto"); fs.appendFileSync(".env", "\nJWT_SECRET=" + crypto.randomBytes(48).toString("base64") + "\n")'
```

`JWT_SECRET`은 API 부팅에 필수다. 위 명령은 값을 터미널에 출력하지 않고 로컬 `.env`에
추가한다. `.env`는 커밋하지 않는다. 이미 파일이 있으면 복사로 덮어쓰지 말고 기존 키를 유지한다.
키가 없는 파일에만 위 생성 명령을 한 번 실행한다. 기존 환경의 키 교체는 별도 작업이다.

| 설정 | 필수 여부 | 없을 때 |
| --- | --- | --- |
| JWT_SECRET | 필수, 32자 이상 | API 부팅 실패 |
| MEILI_MASTER_KEY | 로컬 템플릿에 개발용 값 있음 | 검색 설정 검증 실패. Compose와 API가 같은 값을 사용해야 함 |
| DATABASE_URL · MEILI_HOST · API_PORT | 로컬 기본 스택에서는 생략 | PORT_OFFSET에서 계산 |
| Google OAuth | 선택 | Google 로그인 불가. 데모 발급 사용 가능 |
| 토스 테스트 키 | 선택 | 토스 결제 사용 불가. 가상 카드 사용 가능 |
| R2 설정 | 선택 | 이미지 업로드 사용 불가. 시드는 R2 이미지 없이 진행 가능 |

## 여러 워크트리를 동시에 쓸 때

기본 포트를 이미 쓰고 있다면 실행 전에 `.env.local`에 다음을 넣는다. 다른 워크트리와
오프셋·Compose 프로젝트 이름이 겹치지 않게 고른다.

```dotenv
PORT_OFFSET=30
COMPOSE_PROJECT_NAME=shopping-portfolio
```

```bash
pnpm ports
```

포트는 shop 3000, seller 3001, admin 3002, API 4000, PostgreSQL 5432, Meilisearch 7700에
오프셋을 더한 값이다. `COMPOSE_PROJECT_NAME`은 DB·검색 컨테이너와 볼륨의 경계를 나눈다.
명시적인 연결 주소가 있다면 포트 파생보다 우선하므로 먼저 확인한다.

## 인프라와 데이터 준비

```bash
pnpm infra:up
pnpm db:deploy
pnpm db:seed
pnpm search:reindex
pnpm dev
```

기본 시드는 상품 800개를 준비한다. 작은 데이터로 시작하려면 `pnpm db:seed --scale=small`을
사용할 수 있다. 재색인은 실행 중인 Meilisearch가 필요하다. `pnpm dev`는 웹 세 앱과 API를 실행한다.

기본 API 주소는 `http://localhost:4000/api/v1/health`다. health의 HTTP 상태만 보지 말고
DB와 검색 상태도 확인한다. 검색 준비 중에는 검색 결과가 바로 나오지 않을 수 있다.

Google·토스·R2의 외부 계정은 기본 데모 구매에 필수가 아니다. 실제 이미지가 있는 배포 환경과
로컬 시드의 화면은 다를 수 있다. 상품 이미지 조달은 [기존 개발 README](../README.md)의 시드 설명을 참조한다.

## 검증과 종료

```bash
pnpm typecheck
pnpm lint
pnpm test
```

API 테스트는 실제 PostgreSQL을 사용하고, 검색 통합 테스트에는 Meilisearch도 필요하다.
전체 테스트를 현재 개발 DB에 대한 단순 롤백 방식으로 실행하지 않는다. 워커 DB를 준비하는
[테스트 하네스](../apps/api/test/support/database.ts)를 사용한다.

E2E는 세 앱·API·검색과 시드가 준비된 상태에서 실행한다. 실행 설정은
[Playwright 설정](../e2e/playwright.config.ts)과 [E2E 워크플로](../.github/workflows/e2e.yml)를 따른다.

개발 서버는 실행한 터미널에서 종료하고 `pnpm infra:down`으로 컨테이너를 내린다.
볼륨은 유지된다. `infra:reset`은 데이터를 삭제하는 명령이므로 일반 종료에 사용하지 않는다.

## 검증 상태

이 절차의 필수 설정과 스크립트를 코드와 대조했다. 빈 환경에서 전체 절차를 끝까지 수행한
검증은 아직 별도 완료 기준이며 [초안 점검표](./portfolio-status.md)에 기록한다.
