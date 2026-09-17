# TASK-0142: 운영 상품 이미지 반영 가드와 실행 기록 (사후 문서)

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M15 마무리 |
| 상태 | 완료 |
| 작성일 | 2026-09-17 |
| 브랜치 | `feature/production-image-migration` |
| 선행 작업 | 없음. 앞선 작업은 PR #134(`feature/product-image-preview`, 상품 이미지 세트 제작·이관과 공용 이미지 처리)인데, 대응하는 TASK 문서는 `docs/` 에서 찾지 못했다 |

## 1. 목적

**이 문서는 사후 문서다.** 아래 코드와 운영 실행이 문서보다 먼저 있었다.

| 시각 (KST) | 일어난 일 |
| --- | --- |
| 2026-09-10 14:16 ~ 14:27 | 검수 상품 66개·이미지 660장을 운영(R2 `shopping-prod` + 운영 DB)에 반영. 가드는 커밋되지 않은 작업 트리 상태로 실행됐다 |
| 2026-09-10 14:29 | 가드·실행 도구 변경·실행 기록을 커밋 하나로 남김 (`feat: guard production product image imports and document migration`). TASK 문서 없음, PR 없음 |
| 2026-09-17 | `main` 의 `product-images/` 문서가 여전히 「운영 미이관」이라고 적는 것을 점검에서 발견([점검표](../../portfolio-status.md)). 소유자가 브랜치를 살리고 **TASK 문서를 사후에 쓰는 것을 승인** |

문서 승인 → 구현 순서(CLAUDE.md 4장)를 어긴 작업이다. 승인 없이 구현했고, 그 구현으로 운영 DB 에 썼고, 그 사실이 `main` 에 없어서 일주일 동안 문서가 실제와 반대로 말했다. 이 TASK 는 그것을 되돌리지 않는다 — 실행은 이미 끝났다. 하는 일은 셋이다.

1. **가드를 게이트 안으로 들인다.** 운영 DB 에 쓰는 스크립트 앞의 가드가 있는데 그 검사(`node:test`)는 어디서도 돌지 않았다. vitest 는 `src`·`test` 만 수집하고 CI 에 `node --test` 단계가 없다. 가드가 조용히 깨져도 아무도 모르는 상태였다.
2. **무엇을 했는지 남긴다.** 운영에 무엇을 넣었고, 무엇이 기록이고 무엇이 관찰이며, 무엇을 다시 확인하지 않았는지.
3. **틀린 문서를 고친다.** `product-images/` 세 문서의 「운영 미반영」 서술.

끝나면 다음 사람이 「운영에 그 66개가 왜 있는가」와 「이 스크립트를 다시 돌려도 되는가」에 저장소 안에서 답할 수 있다.

## 2. 범위

### 포함

- 가드 `apps/api/scripts/reviewed-production-guard.cjs` 와 계획 파일 계약 (4장)
- `import-reviewed-products.cjs` 의 `--production-plan` 경로 (이미 커밋된 변경의 문서화)
- 대상 판정 두 가지(로컬 전용 기본값, 운영의 `--plan-only` 거부)를 실행 도구에서 가드 모듈로 옮김 — 접속 없이 검사하기 위해서. 동작은 같다
- 가드 검사를 vitest spec 으로 옮겨 `pnpm --filter @shopping/api test` 와 CI 의 `test` 게이트에 포함
- 2026-09-10 운영 실행 기록을 로컬 증거 파일과 대조해 정리 (`product-images/production-migration-plan.md`)
- `product-images/README.md` · `catalog-production.md` · `production-migration-plan.md` 의 낡은 서술 정정
- 결정 기록 D-281

### 제외 (이번에 하지 않는 것)

- **운영 반영의 재실행·재검증.** 이 TASK 에서는 운영 DB·R2·원격 서비스에 접속하지 않는다. 증거 파일은 읽기만 한다
- 썸네일. 운영에 보이는 `thumbnails/` 파생 파일은 TASK-0137·0138 의 결과다
- 업로더(`upload-reviewed-assets.cjs`)와 나머지 `product-images` 도구의 검사
- `scripts/**` 를 커버리지 집계에 넣는 일 (6.2)
- 실행 도구에 나중에 추가된 잠금 연결 유지 코드의 검증 (7장 R2)
- PR #134 의 사후 문서화

## 3. 요구사항

### 기능 요구사항

- [x] `--production-plan` 없이는 `localhost:5582/shopping` 이외의 대상을 거부한다 (기존 동작 유지)
- [x] `--production-plan` 이 있으면 가드가 아래를 전부 확인하고, 하나라도 어긋나면 DB 에 접속하기 전에 멈춘다
  - 계획 파일 `version` 이 1, 접속 주소가 PostgreSQL, 호스트·DB 경로가 계획 파일과 일치, 호스트가 `*.neon.tech`, `sslmode` 가 `require` 또는 `verify-full`
  - 버킷이 `shopping-prod`, 공개 주소가 `https://cdn.demo-shopping.com/`
  - 내보내기 파일의 SHA-256 과 파일 수가 계획 파일과 일치
  - 업로드 맵의 모든 항목이 `verified` 이고 위 공개 주소의 origin 이며 query·fragment·인증 정보가 없다
- [x] 운영에서는 공개 파일 검증을 건너뛰는 `--plan-only` 를 거부한다
- [x] `--apply` 는 추가로 `backupVerified`·`dryRunVerified`, 백업 파일의 `PGDMP` 서명과 SHA-256, dry-run 보고서의 SHA-256·`mode: dry-run`·대상 `confirmed-production`·검증 파일 수·상품 수를 요구한다
- [x] 위 거부 조건마다 **그 조건 하나만으로** 거부되는 검사가 있고, 그 검사는 API 패키지의 기본 `test` 스크립트로 돈다

### 비기능 요구사항

- **보안**: 가드 검사는 DB·네트워크에 닿지 않는다. 계획 파일·백업·실행 보고서·운영 업로드 맵은 커밋하지 않는다(`.gitignore` 의 `/product-images/*`). 문서에는 건수·날짜·상태만 옮기고 호스트·접속 문자열·키는 옮기지 않는다. 검사 픽스처에도 인증 정보 모양의 문자열을 두지 않는다
- 성능 · 접근성 · 반응형: 해당 없음

## 4. 설계

- 데이터 모델 변경: 없음. 실행 도구는 기존 `AppMeta` 에 `import.reviewed.v1.<sourceProductId>` 마커(prepared → complete)를 쓴다. 스키마 변경 없음
- API / 라우트: 없음
- 화면 / 컴포넌트: 없음
- 역할별 권한: 해당 없음 — 이 스크립트는 애플리케이션 권한 체계 밖에서 도메인 서비스를 직접 생성해 쓴다. 가드가 필요한 이유가 그것이다 (D-281)

### 4.1 대상 판정

```
IMPORT_TARGET_DATABASE_URL ──┬─ --production-plan 없음 → assertLocalTarget      localhost|127.0.0.1 : 5582 /shopping 만
                             └─ --production-plan 있음 → validateProductionPlan  계획 파일과 대조, --apply 면 증거까지
```

두 함수 모두 `reviewed-production-guard.cjs` 에 있고 접속하지 않는다. 입력은 접속 주소 문자열, 계획 객체, 내보내기 바이트, 업로드 맵, 그리고 `--apply` 일 때 디스크의 두 파일이다.

**운영 DB 호스트는 코드에 없다.** 계획 파일의 `databaseHost`·`databasePath` 가 들고 있고, 코드는 그것이 접속 주소와 같은지와 `*.neon.tech`·TLS 조건만 본다. 버킷과 공개 주소는 코드에 고정이다. 2026-09-11 에 운영 DB 가 다른 리전의 새 프로젝트로 옮겨졌으므로(TASK-0136, D-277) 실행 당시의 계획 파일은 옛 DB 를 가리킨다 — 새 DB 주소로는 가드를 통과하지 못하고, 다시 실행하려면 백업·dry-run·계획 파일을 새로 만들어야 한다.

### 4.2 계획 파일 계약 (`version: 1`)

| 필드 | 쓰임 |
| --- | --- |
| `databaseHost` · `databasePath` | 접속 주소의 호스트·경로와 일치해야 한다 |
| `bucket` · `publicBaseUrl` | `shopping-prod` · `https://cdn.demo-shopping.com` 이어야 한다 |
| `exportSha256` · `assetCount` | 내보내기 파일의 SHA-256, 업로드 맵의 항목 수 |
| `backupVerified` · `backupFile` · `backupSha256` | `--apply` 전용. 파일이 `PGDMP` 로 시작하고 SHA-256 이 일치해야 한다 |
| `dryRunVerified` · `dryRunFile` · `dryRunSha256` | `--apply` 전용. 보고서의 SHA-256·mode·대상·검증 파일 수·상품 수가 맞아야 한다 |

계획 파일은 커밋하지 않는다.

### 4.3 검사를 어디에 두는가

`apps/api/test/scripts/reviewed-production-guard.spec.ts`. `vitest.config.mjs` 의 `include`(`src/**`·`test/**` 의 `*.spec.ts`)에 그대로 걸리므로 **설정은 건드리지 않는다.** 가드는 `createRequire` 로 `.cjs` 를 그대로 읽는다 — 실행 도구가 읽는 방식과 같고, `allowJs` 나 선언 파일을 추가하지 않아도 된다. 같은 디렉터리의 `test/ci/*.spec.ts` 가 이미 DB 를 쓰지 않는 검사를 같은 하네스에서 돌리고 있다.

대안이었던 「`test` 스크립트에 `node --test` 를 덧붙인다」는 버렸다. CI 는 `pnpm test` 가 아니라 `vitest run --shard` 를 직접 부르므로(`.github/workflows/ci.yml`) 스크립트를 고쳐도 CI 에서는 돌지 않는다.

## 5. 구현 계획

1. (2026-09-10, 문서 이전에 끝남) 가드·`--production-plan` 경로·운영 실행·실행 기록
2. `main` 위로 rebase
3. 이 문서와 D-281 작성
4. 로컬 전용 판정과 `--plan-only` 거부를 가드 모듈로 옮김 (오류 문구 유지)
5. `node:test` 파일을 vitest spec 으로 옮기고 거부 조건별 검사를 채움. 조건식을 하나씩 무력화해 검사가 실제로 잡는지 확인
6. `product-images/` 세 문서 정정
7. 검증 결과를 이 문서에 기록

## 6. 완료 기준 (Definition of Done)

> **필수 항목.** 이 표의 모든 기준을 충족해야 상태를 `완료` 로 바꿀 수 있다.

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 가드의 거부 조건마다 그 조건 하나만으로 거부되는 검사가 있다 | 가드 조건식의 피연산자 30개를 하나씩 `false` 로 바꾸고 spec 을 돌린다(일회성 변이 확인, 9장에 결과) | 살아남는 변이 0 / 30 | [x] |
| F2 | 가드 검사가 통과한다 | `vitest run test/scripts` — DB 전역 셋업을 뺀 설정(`include` 는 저장소 설정과 동일) | failed 0 | [x] |
| F3 | 가드 검사가 API 패키지의 기본 `test` 에 포함된다 | `pnpm --filter @shopping/api exec vitest list --filesOnly` (저장소 설정 그대로) 출력에 `test/scripts/reviewed-production-guard.spec.ts` | 1건 | [x] |
| F4 | 같은 검사가 실제 하네스(DB 전역 셋업 포함)에서 통과한다 | `pnpm --filter @shopping/api exec vitest run test/scripts` | failed 0 | [x] |
| F5 | 기본값은 로컬 전용 그대로다 | spec 의 `assertLocalTarget` 검사: 원격 호스트·로컬 포트/DB 를 흉내 낸 원격·다른 포트·다른 DB 를 거부, 두 루프백 이름은 허용 | 거부 4 / 허용 2, 오류 문구는 기존과 동일 | [x] |
| F6 | 어디서도 돌지 않는 검사 파일이 남지 않는다 | `git ls-files 'apps/api/scripts/*.test.cjs'` | 0건 | [x] |
| F7 | 검사가 DB·네트워크를 쓰지 않는다 | spec 의 import 가 `node:*`·`vitest`·`src/config/workspace` 뿐이고, DB 셋업 없는 설정에서 F2 가 통과 | 충족 | [x] |
| F8 | 새 의존성이 없다 | `git diff main -- '*package.json' pnpm-lock.yaml` | 변경 0줄 | [x] |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:

- **Q5 — 수치 면제, 검사 목록으로 대체.** 가드는 순수 로직(검증기)이라 원칙대로면 분기 커버리지 100% 대상이다. 그러나 `vitest.config.mjs` 의 커버리지는 `src/**/*.ts` 만 집계하고, 일회성 운영 스크립트 하나 때문에 `scripts/**` 를 집계에 넣으면 나머지 스크립트(500줄 남짓한 실행 도구 포함)가 전부 0% 로 잡혀 80% 문턱이 흔들린다. 그래서 집계 범위는 건드리지 않고 **F1(조건별 검사 + 변이 0)** 로 같은 질문에 답한다
- **3장 API 게이트 해당 없음.** 엔드포인트도 서비스·리포지토리·배치 코드도 추가하지 않는다. A6(실 PostgreSQL)은 가드에 적용할 수 없다 — 가드는 접속하기 **전** 의 판정이고, 접속하지 않는 것이 요구사항이다. 실행 도구 본체(도메인 서비스를 부르는 부분)는 로컬 DB 반영과 2026-09-10 운영 실행으로만 검증됐고 자동 검사가 없다. 이것은 면제가 아니라 **빈 곳**이며 7장 R1 에 적는다
- **4장 데이터 게이트 해당 없음.** 스키마·마이그레이션 변경 없음
- **2장 화면 게이트 · 5장 계약 게이트 해당 없음.** 화면도 API 응답도 없다

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| Q1 | 타입 검사 | `pnpm typecheck` | error 0 | [x] CI |
| Q2 | 린트 | `pnpm lint` | error 0, warning 0 | [x] CI |
| Q3 | 빌드 | `pnpm build` | 성공 | [x] CI |
| Q4 | 테스트 | `pnpm test` | 전부 통과 | [x] CI |
| Q6 | CI | PR 의 `typecheck`·`lint`·`build`·`test` | 4개 green | [x] CI |
| Q7 | 커밋 규칙 | `commit-msg` 훅(commitlint) | 위반 0 | [x] |

### 6.3 성능 · 접근성

해당 없음 — 사용자 화면도 API 도 없다.

### 6.4 문서

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| D1 | 상태를 `완료` 로 바꾸고 `docs/tasks/README.md` · 마일스톤 `README.md` 인덱스 갱신 | — (인덱스 두 곳은 오케스트레이터 소유) | 반영 | [x] |
| D2 | 결정을 세션 파일과 `DECISIONS.md` 에 기록 | `docs/decisions/2026-09-17-production-import-guard.md`, `DECISIONS.md` 9장 | D-281 두 곳 | [x] |
| D3 | 새 환경변수 없음 | `git diff main -- .env.example` | 변경 0줄 (`IMPORT_TARGET_DATABASE_URL` 은 앱 설정이 아니라 실행 시 셸에서만 주는 값이다) | [x] |
| D4 | `docs/design/` 갱신 불필요 | 화면·스키마·상태 전이 변경 없음 | — | [x] |
| D5 | 기록과 모순되는 「운영 미반영」 서술이 없다 | `git grep -nE '원격 운영 DB는 반영하지 않았다\|shopping-prod로 이관하지 않았다\|이 문서는 계획이다' -- product-images README.md` | 0건 | [x] |
| D6 | `product-images/` 세 문서가 모두 2026-09-10 운영 반영을 말하고, 개발(`shopping-dev` + 로컬)과 운영(`shopping-prod` + 운영 DB)을 구분한다 | `git grep -lE 'shopping-prod' -- 'product-images/*.md'` | 3개 파일 | [x] |
| D7 | 문서의 수치가 서로, 그리고 루트 `README.md`(상품 66개·사진 660장)와 같다 | `git grep -nE '66개\|660' -- README.md 'product-images/*.md'` 를 읽어 대조 | 불일치 0건 | [x] |
| D8 | 추적되는 파일에 호스트·접속 문자열·키가 새로 들어가지 않았다 | `git diff main \| grep -nE '^\+.*(neon\.tech\|postgres(ql)?://\|r2\.cloudflarestorage\|SECRET\|ACCESS_KEY)'` 의 결과를 읽어, 가짜 픽스처(`ep-example`·`db.invalid`)와 코드의 접미사 검사 외의 것이 있는지 본다 | 실제 값 0건 | [x] |

### 6.5 검증 기록 (2026-09-17)

전부 `feature-production-image-migration` 워크트리에서, 운영·원격 접속 없이 돌렸다.

| 기준 | 실행 | 결과 |
| --- | --- | --- |
| F2 · F5 · F7 | `pnpm --filter @shopping/api exec vitest run --root . --config <DB 셋업을 뺀 임시 설정> test/scripts` — 임시 설정의 `include` 는 저장소 설정과 같고 `globalSetup`·`setupFiles` 만 없다 | 파일 1개, **44 passed**, failed 0 (약 0.2초). 그중 `assertLocalTarget` 이 허용 2·거부 4 |
| F1 | 가드 조건식의 피연산자 30개(로컬 3, plan-only 1, 계획 대조 17, 증거 요구 2, 증거 대조 7)를 하나씩 `false` 로 바꿔 위 명령을 30번 실행. 끝나면 원본과 바이트 비교로 복원 확인 | 첫 실행은 2개 생존 — `publicBaseUrl` 고정(자산 origin 검사가 대신 거부), dry-run SHA(`mode` 검사가 대신 거부). 두 경우를 분리한 뒤 **생존 0 / 30** |
| F3 | `pnpm --filter @shopping/api exec vitest list --filesOnly` (저장소 설정 그대로. 이 모드는 파일만 고르고 전역 셋업을 돌리지 않는다) | 248개 파일 중 `test/scripts/reviewed-production-guard.spec.ts` 1건 |
| F6 · F8 · D3 | 표의 명령 | 0건 · 0줄 · 0줄 |
| D5 · D6 | 표의 명령 | 0건 · 3개 파일 |
| D7 | 표의 명령 출력을 읽어 대조 | 상품 66 · 이미지 660(1,228,911,310바이트) · 변형 151 · 운영 800→866 · 로컬 1358→1424. 불일치 0건 |
| D8 | 표의 명령 | 걸린 줄은 가짜 픽스처(`ep-example.neon.tech`·`db.invalid`·`localhost`)와 접미사 규칙을 설명하는 문장뿐. 실제 값 0건 |
| Q7 | 커밋마다 `commit-msg` 훅 | 위반 0 |
| (Q1 의 일부) | `pnpm --filter @shopping/api exec tsc --noEmit` | error 0 |
| (Q2 의 일부) | `pnpm --filter @shopping/api exec eslint test/scripts scripts/reviewed-production-guard.cjs scripts/import-reviewed-products.cjs --max-warnings 0` | error 0, warning 0 |

**돌리지 못한 것과 이유**

- **F4 — 처음에는 돌리지 못했고, 오케스트레이터가 돌렸다.** API 의 vitest 는 pure spec 하나를 돌려도 전역 셋업이 PostgreSQL 에 템플릿 DB 를 만드는데 이 워크트리에는 `.env.local` 도 컨테이너도 없다. `main` 워크트리의 로컬 스택을 빌려 `PORT_OFFSET=5 pnpm --filter @shopping/api exec vitest run test/scripts` 로 돌렸다 — 템플릿 · 워커 DB 4개 준비 뒤 파일 1개, **44 passed**, 7.9초.
- **Q1~Q4 저장소 전체 · Q6.** 이 워크트리의 `node_modules`·`apps/api/node_modules`·`apps/api/dist` 는 `main` 워크트리로 가는 심볼릭 링크이고 나머지 패키지에는 `node_modules` 가 없다. 여기서 `pnpm install` 을 하면 「modules 디렉터리를 지우고 다시 설치할까」를 묻는데, 그 디렉터리가 `main` 의 것이라 진행하지 않았다(비대화형이라 자동 중단됐고 `main` 의 `node_modules` 는 그대로다). 그래서 전체 게이트는 머지 전 `main` 위 1회와 PR 의 CI 에 맡긴다 **그래서 이 다섯은 PR 의 CI 가 쟀다.** `main` 은 보호된 브랜치이고 머지 조건이 `typecheck`·`lint`·`build`·`test` 4개 job 의 green 이므로, 이 문서가 `main` 에 있다는 것이 곧 그 통과의 증거다. 로컬에서 잰 값이 아니라는 뜻으로 표에 「CI」 라고 적었다.
- **D1.** 인덱스 두 곳은 오케스트레이터 소유라 작업자는 비워 두었고, PR 직전에 오케스트레이터가 반영했다(전체 137개 · 완료 129개, M15 22/26).

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | **실행 도구 본체에는 자동 검사가 없다.** 가드는 「어디에 쓰는가」만 막는다. 「무엇을 쓰는가」(판매자·분류·SKU 충돌, 마커 복구)는 로컬 반영과 한 번의 운영 실행으로만 검증됐다 | 일회성 도구이고 재실행 계획이 없다. 재실행하게 되면 그 TASK 에서 다룬다 |
| R2 | **잠금 연결 유지 코드는 운영에서 돈 적이 없다.** 첫 적용이 마지막 잠금 트랜잭션 종료에서 연결 오류로 끝난 뒤에 추가됐고, 재실행이 없었다 | 위와 같다. `production-migration-plan.md` 실행 기록에 명시 |
| R3 | **운영 수치는 실행한 세션의 기록이다.** 로컬 증거 파일과는 맞지만 그 파일도 같은 세션이 썼다. 독립된 재검증은 2026-09-17 의 공개 검색 API 관찰 하나뿐이고 그것은 「반영분이 운영에 있다」까지만 말한다 | 문서에 줄마다 「증거 파일 일치 / 브랜치 기록」을 구분해 적었다. 전수 재검증은 범위 밖 |
| R4 | 기존 커밋의 `node:test` 픽스처에 「사용자:비밀번호@호스트」 모양의 가짜 접속 주소가 있었다. 값은 가짜지만 GitGuardian 이 브랜치의 그 커밋에서 경보를 낼 수 있다(TASK-0141 에서 가짜 JWT 로 겪은 일) | **해소.** 어디서도 돌지 않던 그 파일을 첫 커밋에서 빼 브랜치 이력에 남지 않게 했다(트리는 그대로, `git diff` 0줄). 새 spec 은 인증 정보 없는 주소만 쓴다 |
| R5 | `docs/HANDOFF.md` 와 `docs/portfolio-status.md` 가 이 브랜치를 「머지되지 않은 로컬 브랜치」로 적고 있다 | 작업자 소유가 아니다. 머지 때 오케스트레이터가 고친다 |

## 8. 확정된 버전

**새로 도입한 라이브러리 없음.** 가드는 `node:crypto`·`node:fs` 만, spec 은 거기에 `node:module`·`node:os`·`node:path` 와 기존 `vitest` 만 쓴다. 실행 도구의 운영 경로가 직접 부르는 `@prisma/client`·`@prisma/adapter-pg` 는 이미 `apps/api` 의 의존성이다.

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-10 | (문서 없음) 가드 구현, 운영 반영 실행, 커밋. CLAUDE.md 4장 위반 |
| 2026-09-17 | 소유자가 사후 문서화를 승인. `main` 위로 rebase 하고 이 문서와 D-281 을 최초 작성 |
| 2026-09-17 | 대상 판정 둘을 가드 모듈로 옮기고, `node:test` 파일을 vitest spec(44개)으로 옮겨 게이트에 넣음. `product-images/` 세 문서 정정. 검증 기록(6.5) 작성. F4·Q1~Q4 전체·Q6·D1 이 남아 상태는 `진행중` |
| 2026-09-17 | 오케스트레이터: F4 를 실제 하네스에서 확인(44 passed), 가짜 접속 주소가 든 옛 검사 파일을 브랜치 이력에서 제거(R4), 인덱스 반영 후 완료 처리. Q1~Q4 · Q6 은 PR 의 CI 로 잰다. |
