# TASK-0007: 개발 워크플로 · CI

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M01 기반 구축 |
| 상태 | 완료 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/dev-workflow` |
| 선행 작업 | TASK-0006 |

## 1. 목적

품질 게이트를 자동화한다. 커밋 시점과 PR 시점에 규칙이 강제되어, 이후 모든 TASK 의 완료 기준 Q1~Q4 를 사람이 매번 확인하지 않아도 되게 한다.

## 2. 범위

### 포함
- Git hook: 커밋 전 lint-staged (변경 파일만 lint + format)
- 커밋 메시지 검증 (Conventional Commits)
- GitHub Actions CI: PR 에서 `typecheck` / `lint` / `build` / `test` 실행
- pnpm store 캐시로 CI 시간 단축
- PR 템플릿 (관련 TASK 링크, 완료 기준 체크 항목)
- `main` 브랜치 보호 규칙 문서화
- **루트 파일 lint·format 커버리지** — 아래 참조

### 루트 파일 커버리지 (TASK-0002 에서 이월)

`pnpm lint` · `pnpm format:check` 는 `pnpm -r` 로 워크스페이스 패키지에만 전파되고 **루트 프로젝트는 제외된다.** 즉 `scripts/ports.mjs` · `scripts/only-pnpm.mjs` · `scripts/infra.mjs` 와 루트 설정 파일들이 지금 어떤 검사도 받지 않는다.

```
검사됨    apps/*/**, packages/*/**
검사 안 됨  scripts/*.mjs, 루트 *.json, *.yml, docs/**/*.md
```

lint-staged 는 **변경된 파일 경로**를 기준으로 도구를 부르므로, 루트 파일이 스테이징되면 eslint·prettier 가 그 경로에 대해 실행된다. 루트에 이 파일들을 담당할 설정이 없으면 훅이 실패하거나(설정 없음) 조용히 통과한다(무의미). 이 TASK 에서 루트 검사 경로를 만들어 해소한다.

#### 해소 결과

| 항목 | 결과 |
| --- | --- |
| eslint | 루트 `eslint.config.mjs` 추가. `apps/**` · `packages/**` 를 제외하고 `scripts/*.mjs` 와 루트 도구 파일을 검사한다. `pnpm lint` 가 `lint:root` → `pnpm -r lint` 순으로 돈다 |
| prettier | 루트 `prettier.config.mjs` + `.prettierignore` 추가. `pnpm format:check` 는 루트 한 번으로 **저장소 전체**를 본다 (`pnpm -r` 를 쓰지 않는다) |
| 규칙 실효성 | eslint base 프리셋의 `eqeqeq` · `no-var` · `prefer-const` · `no-unused-vars` 를 `.js/.mjs` 에도 적용. 루트 파일은 전부 `.mjs` 라 이 규칙이 없으면 `js.configs.recommended` 만 걸려 검사가 사실상 비어 있었다 |
| 실제로 걸린 것 | `docker-compose.yml` · `scripts/infra.mjs` · `scripts/web-app.mjs` 가 새 format 검사에 걸려 수정됐다 |
| 검증 | `scripts/ports.mjs` 에 미사용 변수를 넣자 `pnpm lint` 가 `52:9 error 'unusedProbe' is assigned a value but never used no-unused-vars` 로 잡았다. 같은 파일을 커밋하려 하자 `pre-commit` 훅이 같은 위치를 출력하고 커밋을 중단했다 (F1) |

**마크다운은 prettier 대상에서 제외했다.** 표를 CJK 폭 기준으로 다시 정렬하고 문서 안의 fenced 코드 예제까지 다시 쓰기 때문에, 포맷이 아니라 문서 수정이 된다 (대상 141개 파일). 이유는 `.prettierignore` 에 적어 두었다.

**루트 `.mjs` 의 typecheck 는 넣지 않았다.** `allowJs` + `checkJs` 로 켜 보니 `scripts/` 세 파일에서 오류 40건(대부분 `TS7006` 암시적 any)이 나온다. 해소하려면 세 파일 전체에 JSDoc 타입을 달아야 하는데 이 이월 사항의 범위(lint·format)를 넘는다. 필요하면 별도 TASK 로 다룬다.

### CI 작업 순서 (TASK-0004 에서 이월)

`pnpm typecheck` 와 `pnpm lint` 는 `packages/shared/dist` 가 있어야 통과한다. 로컬에서는 `pnpm install` 의 `prepare` 훅이 이를 만들어주지만, CI job 을 병렬로 쪼개면서 `build` 없이 `typecheck` 만 도는 job 을 만들면 그 job 은 항상 실패한다.

```
install → build → (typecheck ∥ lint ∥ test)
```

각 job 이 독립 실행되므로 **job 마다 `install` 과 `build` 를 선행**하거나, 빌드 산출물을 job 간에 공유해야 한다. 어느 쪽이든 이 순서를 못박는다.

#### 해소 결과

`.github/actions/setup` 복합 액션이 **pnpm 설치 → Node 설치 · 캐시 복원 → `pnpm install --frozen-lockfile` → `pnpm --filter @shopping/shared build`** 까지 수행하고, 4개 job 이 전부 이 액션을 먼저 부른다. 빌드 산출물을 job 간에 공유하려면 앞단에 build job 을 하나 둬야 하는데, 그러면 4개 job 의 병렬성이 사라진다.

`pnpm install` 이 `packages/shared` 의 `prepare` 훅으로 `dist` 를 만들어 주기는 하지만, job 이 그 부수효과에 기대면 안 되므로 명시적으로 빌드한다.

`dist` 가 없을 때 실제로 무엇이 깨지는지 확인했다.

| 명령 | `packages/shared/dist` 없이 실행한 결과 |
| --- | --- |
| `pnpm typecheck` | `error TS2307: Cannot find module '@shopping/shared'` (apps/api 등) |
| `pnpm lint` | `@typescript-eslint/no-unsafe-*` 대량 발생 — 타입이 풀려 전부 `any` 가 된다 |
| `pnpm test` | `Failed to resolve entry for package "@shopping/shared"` — 3개 스위트 실패 |

즉 `build` 없이 도는 job 은 typecheck 뿐 아니라 lint · test 도 실패한다. 워크플로에 `build` 를 선행하지 않는 job 은 없다.

### 제외
- 배포 워크플로 (M02)
- E2E 테스트 — TASK-0099 에서 Playwright 로 도입 (D-057)
- 커버리지 게이트 (M05 부터 적용, 영역별 기준은 `QUALITY-GATES.md` Q5 참조)

## 3. 요구사항

### 기능 요구사항
- [x] 규칙 위반 코드를 커밋하면 훅이 차단한다
- [x] Conventional Commits 형식이 아닌 메시지는 거부된다
- [x] PR 을 올리면 CI 가 자동 실행되고 — 실패 시 **머지 차단은 `main` 보호 규칙을 켜야 동작한다**(문서화만 함, 6.1 F5 각주 참조)
- [x] CI 가 캐시를 사용해 재실행 시간이 단축된다
- [x] 훅을 우회해야 할 때(`--no-verify` · `HUSKY=0`) 방법이 문서화되어 있다

### 비기능 요구사항
- 커밋 훅은 변경된 파일만 검사한다. 전체 검사로 커밋이 느려지면 안 된다
- CI 는 4개 job 을 병렬 실행한다

## 4. 설계

```
.husky/
├── pre-commit                    lint-staged
└── commit-msg                    commitlint

.github/
├── workflows/ci.yml              typecheck · lint · build · test (병렬 4 job)
├── actions/setup/action.yml      install → packages/shared 빌드 (4 job 공통)
└── pull_request_template.md

루트
├── eslint.config.mjs             scripts/ 와 루트 도구 파일 (apps·packages 제외)
├── prettier.config.mjs           @shopping/config/prettier 재export
├── .prettierignore               생성물 + 마크다운 제외
├── lint-staged.config.mjs        eslint --fix → prettier --write
└── commitlint.config.mjs         config-conventional + type-enum 8개

docs/branch-protection.md         켜는 순서와 켰을 때의 흐름 변화
```

루트 `package.json` 의 검사 스크립트.

| 스크립트 | 내용 |
| --- | --- |
| `lint` | `pnpm run lint:root && pnpm -r --if-present lint` |
| `lint:root` | `eslint . --max-warnings 0` — `pnpm -r` 이 닿지 않는 루트 |
| `format` / `format:check` | `prettier --write .` / `--check .` — 루트 한 번으로 저장소 전체 |
| `prepare` | `husky` — `pnpm install` 이 훅을 설치한다 |

### 커밋 타입

`feat` / `fix` / `docs` / `chore` / `refactor` / `test` / `style` / `perf`

## 5. 구현 계획

1. husky + lint-staged 설치·설정
2. commitlint 설정 (Conventional Commits)
3. GitHub Actions CI 워크플로 작성
4. pnpm 캐시 설정
5. PR 템플릿 작성
6. 실패 케이스로 훅·CI 동작 검증
7. 브랜치 보호 규칙 **문서화** — 규칙을 켜면 지금의 로컬 `rebase → ff-only 머지 → push` 흐름이 막히므로, 켜는 것은 소유자 판단이다. 무엇을 어떤 순서로 켜고 흐름이 어떻게 바뀌는지는 [`docs/branch-protection.md`](../../branch-protection.md) 에 정리했고 **규칙은 켜지 않았다**

## 6. 완료 기준 (Definition of Done)

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 커밋 훅 차단 | `scripts/ports.mjs` 에 미사용 변수를 넣고 커밋 시도 | 커밋 실패, 오류 위치 출력 | [x] |
| F2 | 커밋 메시지 검증 | `git commit -m "asdf"` | 거부됨 | [x] |
| F3 | 자동 포맷 | 들여쓰기·따옴표를 어긋나게 한 파일 커밋 | 자동 수정 후 커밋 성공 | [x] |
| F4 | CI 실행 | PR #1 생성 | 4개 job 실행, 전부 green | [x] |
| F5 | CI 실패 감지 | 타입 오류를 넣은 커밋을 PR 브랜치에 push | typecheck job 실패, 머지 차단 | [x]† |
| F6 | 캐시 동작 | 동일 lockfile 로 CI 재실행 | 의존성 설치 시간 단축 확인 | [x] |

실측 결과.

| # | 실제 결과 |
| --- | --- |
| F1 | `scripts/ports.mjs 52:9 error 'unusedProbe' is assigned a value but never used no-unused-vars` → `husky - pre-commit script failed (code 1)`, 종료 코드 1. 커밋 없음 |
| F2 | `subject may not be empty [subject-empty]` · `type may not be empty [type-empty]` → `husky - commit-msg script failed (code 1)`. `HEAD` 그대로. `ci: …` 도 `type must be one of [feat, fix, docs, chore, refactor, test, style, perf]` 로 거부된다 |
| F3 | `export   function   portFor( service )    {` 와 `const  _probe   =    "F3";` 를 스테이징 → 훅이 `eslint --fix` → `prettier --write` 로 고쳐 다시 스테이징 → 커밋 성공. 커밋된 내용은 `const _probe = 'F3'` (검증 후 커밋 되돌림) |
| F4 | [run 33649228674](https://github.com/presentY1897/demo-shopping/actions/runs/33649228674) — `typecheck` 30s · `lint` 40s · `build` 54s · `test` 31s, **전체 59초** |
| F5 | [run 33649683333](https://github.com/presentY1897/demo-shopping/actions/runs/33649683333) — `typecheck` **fail** (`origins.spec.ts(2,7): error TS2322: Type 'string' is not assignable to type 'number'`), `lint` · `build` · `test` pass. 확인 후 커밋을 되돌리고 브랜치를 force-push 했다 |
| F6 | 1차: `pnpm cache is not found` → `resolved 591, reused 0, downloaded 591`, 설치 **6.35초**. 재실행: `Cache restored from key: node-cache-Linux-x64-pnpm-618623fd…` → `resolved 591, reused 591, downloaded 0`, 설치 **1.56초** |

† F5 의 "머지 차단"은 `main` 보호 규칙을 켜야 동작한다. 이 TASK 의 범위는 규칙 **문서화**이고 규칙은 켜지 않았으므로(→ [`docs/branch-protection.md`](../../branch-protection.md)), 지금은 체크가 빨개도 머지 버튼이 살아 있다 (`mergeStateStatus: UNSTABLE`). 규칙 3번(Require status checks)을 켜면 이 절반도 함께 충족된다. **CI 가 실패를 감지하는 부분은 실측으로 확인됐다.**

F6 보충: 캐시는 **의존성 설치를 6.35초에서 1.56초로 줄이지만**, 캐시 아카이브 자체가 273MB 라 복원에 약 6초가 든다. 그래서 setup 스텝 전체의 벽시계 시간은 지금 규모에서 거의 같다(1차 18~22초 / 2차 17~22초). 레지스트리가 느리거나 의존성이 늘어날수록 이득이 커지는 구조다.

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:

- **Q5(커버리지) 면제** — M05 부터 적용
- **Q6~Q7 은 이 TASK 에서 구축하고 동작을 검증**한다
- **2~4장 해당 없음**
- 추가 기준: CI 전체 소요 시간 5분 이내 → **실측 59초**(1차) · **45초**(캐시 hit 재실행). 충족

### 6.3 성능 · 접근성

**해당 없음**.

### 6.4 문서

| # | 기준 | 충족 | 비고 |
| --- | --- | --- | --- |
| D1a | 이 문서의 상태를 `완료` 로 변경 | [x] | |
| D1b | `docs/tasks/README.md` · `M01-foundation/README.md` 인덱스 2곳 갱신 | [ ] | **머지 담당자가 갱신한다** — 브랜치가 두 파일을 동시에 건드리면 머지 충돌이 난다 |
| D1c | M01 마일스톤 완료 처리 | [ ] | **보류.** TASK-0005 가 `진행중` 이다 (Prisma 7 CLI 가 에이전트의 `migrate reset` 실행을 차단해 F4 를 사용자가 직접 검증해야 한다) |
| D4 | README 에 커밋 규칙·훅 우회 방법 기재 | [x] | README "개발 워크플로" 절: 품질 게이트 · 커밋 훅 · 커밋 메시지 · 훅 우회(`--no-verify` · `HUSKY=0`) · CI |
| D5 | 새 라이브러리 버전 기록 | [x] | 8장 |
| D6 | `CLAUDE.md` 의 커밋 규칙과 실제 설정이 일치하는지 확인 | [x] | 일치. `CLAUDE.md` 3장의 8개 타입 = `commitlint.config.mjs` 의 `type-enum`. `config-conventional` 기본값에 있는 `ci` · `build` · `revert` 는 뺐고, 두 곳을 함께 고쳐야 한다는 제약을 `CLAUDE.md` 에 명시했다 |

기존 커밋 20개(`commitlint --from HEAD~20 --to HEAD`)가 이 설정으로 전부 통과한다 — 규칙이 지금까지의 히스토리와도 어긋나지 않는다.

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | 훅이 느려 커밋 흐름을 방해 | lint-staged 로 변경 파일만 검사. 그래도 느리면 typecheck 는 CI 에만 |
| R2 | E2E 는 아직 없음 | 이번엔 최소 CI(typecheck/lint/build/test)만. E2E 는 TASK-0099 에서 추가하고 모든 PR 에서 실행한다 (D-057) |

## 8. 확정된 버전

| 패키지 | 버전 | 위치 |
| --- | --- | --- |
| husky | 9.1.7 | 루트 devDependencies |
| lint-staged | 17.4.1 | 루트 devDependencies |
| @commitlint/cli | 21.2.2 | 루트 devDependencies |
| @commitlint/config-conventional | 21.2.2 | 루트 devDependencies |
| eslint | 10.9.1 | 루트에도 추가 (루트 파일 검사용, 패키지와 동일 버전) |
| prettier | 3.9.6 | 루트에도 추가 (동일) |
| typescript | 6.0.3 | 루트에도 추가 (동일). **7.x 금지** — typescript-eslint peer 가 `<6.1.0` |
| @shopping/config | `workspace:*` | 루트가 eslint·prettier 프리셋을 재사용한다 |

GitHub Actions.

| 액션 | 버전 |
| --- | --- |
| actions/checkout | v4 |
| actions/setup-node | v4 (`cache: pnpm`) |
| pnpm/action-setup | v4 (버전은 `packageManager` 에서 읽는다) |

세 액션 모두 Node 20 을 타깃해 러너가 Node 24 로 강제 실행한다는 경고를 남긴다. 동작에는 문제가 없고, 각 액션의 v5 가 나오면 올린다.

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-02 | 승인 — M01 착수 |
| 2026-09-03 | 완료. husky·lint-staged·commitlint 훅과 4 job 병렬 CI 를 붙이고, 루트 파일 검사 경로와 CI 작업 순서(이월 2건)를 해소했다. `main` 보호 규칙은 문서화만 하고 켜지 않았다 |
