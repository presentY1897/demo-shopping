# CLAUDE.md

이 파일은 이 저장소에서 작업하는 Claude Code에 대한 필수 지침이다.

## 1. 프로젝트 개요

취업 포트폴리오용 **쇼핑몰(이커머스) 서비스**. "데모" 수준이 아니라 **실제 운영 가능한 수준**을 목표로 한다.

- 역할 분리: **사용자(구매자) / 판매자(셀러) / 사이트 관리자(어드민)** — 각각 별도 페이지 영역
- 데모 계정: 방문자가 로그인 없이 즉석에서 **가짜 데모 계정(역할별)을 발급받아** 전체 기능을 체험 가능
- 디자인: 최대한 **미니멀·심플**
- 상품 상세/목록: **미니멀 ↔ 맥시멀 3단계** 표현 전환
- 카테고리: 초기 데이터는 **패션** 중심, 단 카테고리/속성은 **런타임에 추가·설정 가능한 구조**
- 검색 및 회원 기능(위시리스트, 리뷰, 주문내역, 쿠폰 등) 충실히 구현
- 레퍼런스: 국내외 유명 패션 커머스(무신사, 29CM, SSENSE, Zara 등) + 부분적으로 알리익스프레스/아마존/쿠팡

> 상세 스펙은 `docs/` 참조. 스펙이 문서와 충돌하면 **문서가 기준**이다.

## 2. 저장소 구조 (git worktree)

이 저장소는 **bare + worktree** 레이아웃이다. 루트는 작업 트리가 아니다.

```
shopping/                 <- 저장소 루트 (.git 파일이 .bare 를 가리킴)
├── .bare/                <- 실제 git 디렉터리 (bare)
├── .git                  <- "gitdir: ./.bare"
├── main/                 <- main 브랜치 워크트리 (기준 브랜치)
└── feature-<name>/       <- 기능별 워크트리 (브랜치 feature/<name>)
```

**모든 작업은 워크트리 디렉터리 안에서 수행한다.** 루트에서 `git status` 는 동작하지 않는다(정상).

### 새 기능 시작

```bash
cd <저장소 루트>
git worktree add -b feature/<name> feature-<name> main
cd feature-<name>
```

### 기능 완료 후 정리

```bash
cd <저장소 루트>
git worktree remove feature-<name>
git branch -d feature/<name>
```

### 규칙

- `main` 워크트리에서 직접 기능 코드를 작성하지 않는다. 문서/설정 등 사소한 변경만 허용.
- 워크트리 디렉터리 이름은 `feature-<name>`, 브랜치 이름은 `feature/<name>` 로 짝을 맞춘다.
- 한 브랜치는 한 워크트리에만 체크아웃할 수 있다(git 제약).

## 3. 브랜치 / 커밋

- 브랜치: `feature/<name>`, `fix/<name>`, `chore/<name>`, `docs/<name>`
- 커밋 메시지: **Conventional Commits**
  - `feat: 상품 목록 3단계 뷰 전환 추가`
  - `fix: 장바구니 수량 변경 시 합계 미갱신 수정`
  - `type: feat | fix | docs | chore | refactor | test | style | perf`
- 커밋 본문은 한국어로 작성한다.
- git identity 는 저장소 로컬 설정으로 고정되어 있다: `presenty1897 / presenty1897@gmail.com`

## 4. 문서 기반 진행 원칙 (중요)

이 프로젝트는 **문서 승인 → 구현** 순서로 진행한다.

1. 새 작업은 먼저 `docs/tasks/TASK-<번호>-<slug>.md` 로 계획을 작성한다.
   (템플릿: `docs/tasks/TASK-TEMPLATE.md`)
2. 사용자가 문서를 검토하고 **승인**하면 그때 구현을 시작한다.
3. **승인 전에는 구현 코드를 작성하지 않는다.** 스캐폴딩/실험이 필요하면 먼저 물어본다.
4. 구현 중 계획이 바뀌면 코드보다 **문서를 먼저 갱신**한다.
5. 완료 시 task 문서의 상태를 `완료` 로 바꾸고 `docs/tasks/README.md` 인덱스를 갱신한다.

### 결정 이력

세션(대화)에서 정해진 사항은 반드시 `docs/decisions/` 에 기록한다.

- 파일: `docs/decisions/YYYY-MM-DD-session-NN.md`
- 기록 대상: 기술 선택, 스코프 변경, 정책/규칙 합의, 보류된 논의
- 여러 세션에 걸쳐 누적되므로 **덮어쓰지 말고 추가**한다.
- 인덱스: `docs/decisions/README.md`

## 5. 기술 스택

| 영역 | 선택 |
| --- | --- |
| 저장소 형태 | pnpm workspace **모노레포** |
| 프론트엔드 | **Next.js** (App Router) + TypeScript |
| 백엔드 | **NestJS** + TypeScript |
| DB | **PostgreSQL** + Prisma |
| 검색 | **Meilisearch** (상품 변경 이벤트 기반 인덱싱) |
| 결제 | **토스페이먼츠 테스트 연동** (승인/취소/환불 웹훅 포함) |
| 배송 | 도메인은 실제와 동일하게 구현하되 **운송/추적은 가상 처리** |
| 인증 | JWT (access + refresh), httpOnly 쿠키 |
| 배포 | Vercel(web) + Railway/Render(api, postgres, meilisearch) + 오브젝트 스토리지(이미지) |
| 원격 | GitHub 공개 저장소 |

### 모노레포 레이아웃 (예정)

```
apps/
├── web/        # Next.js — 사용자 / 판매자 / 관리자 화면
└── api/        # NestJS — REST API
packages/
├── shared/     # 공용 타입, zod 스키마, 상수
└── config/     # eslint / tsconfig / prettier 공유 설정
```

- 프론트와 API 사이의 타입은 `packages/shared` 를 단일 출처로 삼는다.
- 세부 구조는 각 TASK 문서에서 확정한다.

## 6. 작업 시 지켜야 할 것

- 사용자와의 대화 언어는 **한국어**.
- 코드 주석/식별자는 영어, 사용자 노출 문구는 한국어를 기본으로 한다.
- 결제는 **토스페이먼츠 테스트 키**로 실제 연동한다(실 결제 아님). 배송은 도메인·상태 전이를 실제와 동일하게 구현하되 운송사 연동 없이 **가상 처리**한다.
- 데모 계정은 **1인당 임시 계정을 발급**하고 일정 시간 후 계정과 생성 데이터를 자동 삭제한다. 상품 카탈로그는 공용, 장바구니/주문/리뷰 등 개인 데이터는 격리한다.
- 다국어는 **구조만 잡고 한국어/KRW 를 우선**한다. UI 문구는 메시지 파일로 분리하고 금액은 통화 정보를 포함한 값으로 모델링한다. (문구 하드코딩 금지)
- 상품 표현 3단계(미니멀↔맥시멀)는 **사용자가 토글**한다. 판매자별 강제 템플릿이 아니다.
- 비밀값은 커밋하지 않는다. `.env.example` 만 커밋한다.
