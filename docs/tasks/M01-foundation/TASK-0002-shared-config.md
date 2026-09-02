# TASK-0002: 공유 설정 패키지

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M01 기반 구축 |
| 상태 | 승인 대기 |
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
├── tsconfig/{base,next,nest}.json
├── eslint/{base,next,nest}.js
└── prettier/index.js

packages/shared/
├── src/index.ts        # 샘플: HealthStatus 타입
└── package.json        # exports 필드로 진입점 노출
```

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
| F1 | 공용 타입 사용 | `packages/shared` 타입을 api·shop 에서 import | `pnpm typecheck` error 0 | [ ] |
| F2 | 전체 타입 검사 | `pnpm typecheck` | 전 패키지 검사, error 0 | [ ] |
| F3 | 전체 린트 | `pnpm lint` | 전 패키지 검사, error 0 warning 0 | [ ] |
| F4 | 포맷 일관성 | `pnpm format --check` | 위반 0건 | [ ] |
| F5 | 규칙 위반 검출 | 미사용 변수를 일부러 추가 후 `pnpm lint` | 해당 파일에서 error 발생 | [ ] |

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
| D1 | 상태 갱신 + 인덱스 2곳 | [ ] |
| D5 | 확정 버전 기록 | [ ] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | Next.js 와 NestJS 의 eslint 요구가 충돌 | base 를 공통으로 두고 프레임워크별 프리셋에서 분기. 그래도 충돌하면 앱별 override |
| R2 | 컴포넌트 라이브러리 설정과 충돌 | Radix 는 스타일이 없어 lint·tsconfig 와 충돌하지 않는다 (D-056) |

## 8. 확정된 버전

| 패키지 | 버전 |
| --- | --- |
| typescript | |
| eslint | |
| prettier | |
| zod | |

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
