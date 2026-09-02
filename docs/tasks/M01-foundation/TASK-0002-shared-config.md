# TASK-0002: 공유 설정 패키지

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M01 기반 구축 |
| 상태 | 완료 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/shared-config` |
| 선행 작업 | TASK-0001 |

## 1. 목적

tsconfig / eslint / prettier 를 한 곳에서 관리하고 모든 패키지가 이를 확장하게 한다. 앱마다 설정이 갈라지는 것을 처음부터 막는다.

## 2. 범위

### 포함
- `packages/config` — tsconfig base / next / nest 프리셋, eslint flat config, prettier 설정
- `packages/shared` — 빌드 파이프라인과 샘플 타입 1개, zod 의존성
- 각 앱이 이 설정을 확장하도록 연결
- 루트 `lint` / `typecheck` / `format` 스크립트를 실제 동작하게 연결

### 제외
- 실제 공용 도메인 타입 (해당 도메인 TASK 에서 추가)
- UI 컴포넌트 (`packages/ui` 는 M03)

## 3. 요구사항

### 기능 요구사항
- [ ] `packages/shared` 의 타입을 다른 패키지에서 import 할 수 있다
- [ ] `pnpm typecheck` 가 전 패키지를 검사한다
- [ ] `pnpm lint` 가 전 패키지를 검사하고 자동 수정(`--fix`)을 지원한다
- [ ] 포맷 규칙이 하나로 통일된다 (탭/스페이스, 세미콜론, 따옴표)

### 비기능 요구사항
- `packages/shared` 는 소스맵을 포함해 빌드하고, 앱에서 정의로 이동(Go to Definition)이 동작해야 한다
- eslint 규칙은 프레임워크별 권장 설정을 기반으로 하되 충돌 시 앱별 override 를 허용한다

## 4. 설계

```
packages/config/
├── tsconfig/{base,next,nest}.json   # 프리셋. 경로는 ${configDir} 로 소비자 기준 해석
├── eslint/{base,next,nest}.js       # baseConfig/nextConfig/nestConfig(rootDir) 함수
└── prettier/index.js                # 단일 포맷 규칙

packages/shared/
├── src/health.ts       # 샘플: HealthStatus (zod 스키마에서 추론)
├── src/index.ts        # 공개 진입점
└── package.json        # exports 필드 + prepare 스크립트로 install 시 자동 빌드

각 패키지 (7개)
├── tsconfig.json         # 프리셋 extends
├── eslint.config.mjs     # 프리셋 함수에 import.meta.dirname 전달
├── prettier.config.mjs   # @shopping/config/prettier 재수출
└── .prettierignore
```

eslint 프리셋을 **객체가 아니라 함수**로 노출하는 이유: 타입 인식(type-aware) 규칙에는 패키지별 tsconfig 위치(`tsconfigRootDir`)가 필요하다. 각 패키지가 `import.meta.dirname` 을 넘긴다.

## 5. 구현 계획

1. `packages/config` 에 tsconfig 3종
2. eslint flat config 3종 (base / next / nest)
3. prettier 설정
4. `packages/shared` 빌드 설정 + 샘플 타입
5. 각 앱에서 확장 연결
6. 루트 스크립트 연결

## 6. 완료 기준 (Definition of Done)

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 공용 타입 사용 | `packages/shared` 타입을 api·shop 에서 import | `pnpm typecheck` error 0 | [x] |
| F2 | 전체 타입 검사 | `pnpm typecheck` | 전 패키지 검사, error 0 | [x] |
| F3 | 전체 린트 | `pnpm lint` | 전 패키지 검사, error 0 warning 0 | [x] |
| F4 | 포맷 일관성 | `pnpm format:check` | 위반 0건 | [x] |
| F5 | 규칙 위반 검출 | 미사용 변수를 일부러 추가 후 `pnpm lint` | 해당 파일에서 error 발생 | [x] |

> **F4 측정 방법 변경** — 최초 계획은 `pnpm format --check` 였다. 실제로 실행해 보면 이 명령은
> 각 패키지에서 `prettier --write . --check` 로 전달되고, prettier 는 두 플래그를 함께 받으면
> **파일을 고쳐 쓴 뒤 종료 코드 0** 을 반환한다. 검사가 아니라 수정이 되므로 게이트로 쓸 수 없다.
> 따라서 패키지마다 `format`(쓰기)과 `format:check`(검사)를 분리했다.
> 루트에 `"format:check": "pnpm -r --if-present format:check"` 스크립트를 추가하면
> `pnpm format:check` 한 줄로 줄어든다. (루트 `package.json` 은 TASK-0003 과 겹쳐 이 TASK 에서 건드리지 않았다.)

> **F3 보강** — 게이트가 `warning 0` 이므로 각 패키지의 `lint` 스크립트에 `--max-warnings 0` 을 붙였다.
> 경고가 실제로 빌드를 실패시켜야 게이트가 의미를 가진다.

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:

- **Q4 해당 없음** — 설정 패키지라 테스트 대상 로직이 없다
- **Q5(커버리지) 면제** — M05 부터 적용
- **Q6~Q7 해당 없음** — TASK-0007 에서 구축
- **3~4장(API·데이터) 해당 없음**

### 6.3 성능 · 접근성

**해당 없음**.

### 6.4 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | [x] |
| D5 | 확정 버전 기록 | [x] |

> D1 의 인덱스 2곳(`docs/tasks/README.md`, `docs/tasks/M01-foundation/README.md`)은
> 다른 M01 작업과 같은 파일을 건드리므로 **머지 시점에 한꺼번에** 갱신한다.

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | Next.js 와 NestJS 의 eslint 요구가 충돌 | base 를 공통으로 두고 프레임워크별 프리셋에서 분기. 그래도 충돌하면 앱별 override |
| R2 | 컴포넌트 라이브러리 설정과 충돌 | Radix 는 스타일이 없어 lint·tsconfig 와 충돌하지 않는다 (D-056) |

## 8. 확정된 버전

| 패키지 | 버전 | 위치 |
| --- | --- | --- |
| typescript | 6.0.3 | 전 패키지 devDependencies |
| eslint | 10.9.1 | 전 패키지 devDependencies |
| prettier | 3.9.6 | 전 패키지 devDependencies |
| zod | 4.5.4 | `packages/shared` dependencies |
| typescript-eslint | 8.69.0 | `packages/config` dependencies |
| @eslint/js | 10.0.1 | `packages/config` dependencies |
| eslint-config-prettier | 10.1.8 | `packages/config` dependencies |
| @next/eslint-plugin-next | 16.3.4 | `packages/config` dependencies |
| eslint-plugin-react-hooks | 7.1.1 | `packages/config` dependencies |
| globals | 17.12.0 | `packages/config` dependencies |

### TypeScript 를 최신(7.0.2)이 아니라 6.0.3 으로 고정한 이유

설치 시점의 최신 안정 버전은 **7.0.2** 지만, `typescript-eslint@8.69.0` 의 peer 범위가
`typescript >=4.8.4 <6.1.0` 이다. 7.x 를 쓰면 타입 인식 린트 규칙 전체가 동작하지 않는다.
**린트 게이트가 타입 검사기보다 우선**이므로 6.0.3 으로 고정한다.
typescript-eslint 가 7.x 를 지원하면 그때 올린다.

### 도입하지 않은 eslint 플러그인

`eslint-plugin-react`(7.37.5)와 `eslint-plugin-jsx-a11y`(6.10.2)는 peer 범위가 eslint 9 까지라
eslint 10 에서 설치 경고가 난다. 두 플러그인이 eslint 10 을 지원하면 `eslint/next.js` 에 추가한다.
그때까지 React 규칙은 `eslint-plugin-react-hooks@7`(React Compiler 규칙 포함)과
`@next/eslint-plugin-next` 가 담당한다.

### 이 TASK 가 만든 규칙 (요약)

| 항목 | 값 |
| --- | --- |
| 포맷 | 세미콜론 없음, 홑따옴표, 2칸 들여쓰기, 최대 100칸, 후행 쉼표 `all` |
| 타입 | `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride` + `noImplicitReturns` |
| 미사용 변수 | tsc 가 아니라 eslint 가 담당 (`^_` 접두사는 예외) |
| 타입 import | `import type { X }` 강제 (`consistent-type-imports` + `no-import-type-side-effects`) |
| shared 빌드 | `tsc` — CommonJS + `declarationMap` + `sourceMap`. `prepare` 로 `pnpm install` 시 자동 빌드 |

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-02 | 승인 — M01 착수 |
| 2026-09-02 | 완료. 설정 프리셋 3종(tsconfig·eslint·prettier)과 `packages/shared` 빌드를 연결하고 7개 패키지에 lint·typecheck·format 스크립트를 붙임. F4 측정 명령을 `format:check` 로 변경 |
