# TASK-0007: 개발 워크플로 · CI

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M01 기반 구축 |
| 상태 | 승인 대기 |
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

### 제외
- 배포 워크플로 (M02)
- E2E 테스트 — TASK-0099 에서 Playwright 로 도입 (D-057)
- 커버리지 게이트 (M05 부터 적용, 영역별 기준은 `QUALITY-GATES.md` Q5 참조)

## 3. 요구사항

### 기능 요구사항
- [ ] 규칙 위반 코드를 커밋하면 훅이 차단한다
- [ ] Conventional Commits 형식이 아닌 메시지는 거부된다
- [ ] PR 을 올리면 CI 가 자동 실행되고 실패 시 머지가 차단된다
- [ ] CI 가 캐시를 사용해 재실행 시간이 단축된다
- [ ] 훅을 우회해야 할 때(`--no-verify`) 방법이 문서화되어 있다

### 비기능 요구사항
- 커밋 훅은 변경된 파일만 검사한다. 전체 검사로 커밋이 느려지면 안 된다
- CI 는 4개 job 을 병렬 실행한다

## 4. 설계

```
.husky/
├── pre-commit        lint-staged
└── commit-msg        commitlint

.github/
├── workflows/ci.yml  typecheck · lint · build · test (병렬)
└── pull_request_template.md
```

### 커밋 타입

`feat` / `fix` / `docs` / `chore` / `refactor` / `test` / `style` / `perf`

## 5. 구현 계획

1. husky + lint-staged 설치·설정
2. commitlint 설정 (Conventional Commits)
3. GitHub Actions CI 워크플로 작성
4. pnpm 캐시 설정
5. PR 템플릿 작성
6. 실패 케이스로 훅·CI 동작 검증
7. 브랜치 보호 규칙 설정 및 문서화

## 6. 완료 기준 (Definition of Done)

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 커밋 훅 차단 | 린트 오류가 있는 파일을 커밋 시도 | 커밋 실패, 오류 위치 출력 | [ ] |
| F2 | 커밋 메시지 검증 | `git commit -m "asdf"` | 거부됨 | [ ] |
| F3 | 자동 포맷 | 포맷이 어긋난 파일 커밋 | 자동 수정 후 커밋 성공 | [ ] |
| F4 | CI 실행 | PR 생성 | 4개 job 실행, 전부 green | [ ] |
| F5 | CI 실패 감지 | 타입 오류를 넣은 PR | typecheck job 실패, 머지 차단 | [ ] |
| F6 | 캐시 동작 | 동일 lockfile 로 CI 재실행 | 의존성 설치 시간 단축 확인 | [ ] |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:

- **Q5(커버리지) 면제** — M05 부터 적용
- **Q6~Q7 은 이 TASK 에서 구축하고 동작을 검증**한다
- **2~4장 해당 없음**
- 추가 기준: CI 전체 소요 시간 5분 이내

### 6.3 성능 · 접근성

**해당 없음**.

### 6.4 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳, **M01 마일스톤 완료 처리** | [ ] |
| D4 | README 에 커밋 규칙·훅 우회 방법 기재 | [ ] |
| D6 | `CLAUDE.md` 의 커밋 규칙과 실제 설정이 일치하는지 확인 | [ ] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | 훅이 느려 커밋 흐름을 방해 | lint-staged 로 변경 파일만 검사. 그래도 느리면 typecheck 는 CI 에만 |
| R2 | E2E 는 아직 없음 | 이번엔 최소 CI(typecheck/lint/build/test)만. E2E 는 TASK-0099 에서 추가하고 모든 PR 에서 실행한다 (D-057) |

## 8. 확정된 버전

| 패키지 | 버전 |
| --- | --- |
| husky | |
| lint-staged | |
| commitlint | |

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
