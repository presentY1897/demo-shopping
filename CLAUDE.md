# CLAUDE.md

이 파일은 이 저장소에서 작업하는 Claude Code에 대한 필수 지침이다.

## 1. 프로젝트 개요

취업 포트폴리오용 **멀티 셀러 이커머스 마켓플레이스**. "데모" 수준이 아니라 **실제 운영 가능한 수준**을 목표로 한다.

- 역할 분리: **구매자 / 판매자 / 사이트 관리자** — 각각 **독립된 Next.js 앱**
- 데모 계정: 방문자가 각 앱에서 **임시 계정을 즉시 발급**받아 전체 기능을 체험 (24시간 후 자동 삭제)
- 디자인: 미니멀·심플. 상품 표현은 **미니멀 ↔ 맥시멀 3단계**를 사용자가 토글
- 카테고리: 초기 데이터는 **패션** 중심, 카테고리·속성은 **관리자 화면에서 추가·설정 가능**
- 주문은 **판매자별로 분할**되고 결제·배송·취소·정산이 각각 다른 단위로 동작한다
- 레퍼런스: 국내외 패션 커머스(무신사, 29CM, SSENSE 등) + 알리익스프레스/아마존/쿠팡 부분 참고

> **작업 전에 반드시 읽을 것**: `docs/decisions/DECISIONS.md` (현재 유효한 모든 결정)
> 스펙이 문서와 충돌하면 **문서가 기준**이다.

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

### 원격

- origin: `git@github-presenty:presentY1897/demo-shopping.git` (GitHub 공개 저장소)
- 이 머신의 **기본 SSH 키는 다른 GitHub 계정에 연결되어 있다.** `~/.ssh/config` 의 `github-presenty` 별칭이 `presentY1897` 전용 키를 쓰므로, origin URL 에 `github.com` 을 직접 쓰면 push 권한이 없다.

### 규칙

- **`main` 은 보호된 브랜치다. 직접 push 할 수 없다** (관리자 포함). 모든 변경은 PR 을 거친다.
- `main` 워크트리는 이제 **`git pull --ff-only` 만 하는 곳**이다. 여기서 커밋하지 않는다.
- 워크트리 디렉터리 이름은 `feature-<name>`, 브랜치 이름은 `feature/<name>` 로 짝을 맞춘다.
- 한 브랜치는 한 워크트리에만 체크아웃할 수 있다(git 제약).

### 머지 흐름

```bash
# feature-<name> 워크트리
git rebase main                       # 규칙상 main 기준 최신이어야 머지된다
git push -u origin feature/<name>
gh pr create --fill

gh pr checks --watch                  # typecheck · lint · build · test 4개 green 대기
gh pr merge --rebase --delete-branch

# 저장소 루트 — 워크트리를 먼저 지워야 로컬 브랜치가 지워진다
git worktree remove feature-<name>
git branch -D feature/<name>

# main 워크트리
git pull --ff-only
pnpm install            # 의존성이 바뀌었을 수 있다. 새 워크트리를 만들 때도 필수
```

- 머지 방식은 **rebase 만** 허용된다. squash 는 저장소 설정에서 껐다 — TASK 당 5~10개로
  나눈 커밋이 하나로 뭉개지면 안 된다.
- `gh pr merge --rebase` 는 GitHub 이 커밋을 다시 쓰므로 **SHA 가 바뀐다.** 머지 뒤 로컬
  브랜치는 버리고 `main` 을 pull 받는다.
- **병행 작업 시 순서가 있다.** PR 을 하나 머지하면 나머지 PR 은 `main` 기준으로 다시
  rebase·push 해야 한다(규칙 `strict`). 그래서 웨이브의 머지는 순차적이다.
- **머지 뒤 `pnpm install` 을 빠뜨리지 않는다.** 워크트리마다 `node_modules` 가 따로이므로,
  다른 워크트리에서 추가한 의존성은 pull 만으로는 설치되지 않는다. 앱이 안 뜨는 원인 1순위다.
- `--delete-branch` 는 **워크트리에 체크아웃된 브랜치를 지우지 못한다.** 원격 브랜치만 지워지고
  `fatal: 'main' is already used by worktree at ...` 로 끝난다. 워크트리를 먼저 제거한다.
- 자세한 내용과 해제 방법: [`docs/branch-protection.md`](./docs/branch-protection.md)

## 3. 브랜치 / 커밋

- 브랜치: `feature/<name>`, `fix/<name>`, `chore/<name>`, `docs/<name>`
- 커밋 메시지: **Conventional Commits**
  - `feat: 상품 목록 3단계 뷰 전환 추가`
  - `fix: 장바구니 수량 변경 시 합계 미갱신 수정`
  - `type: feat | fix | docs | chore | refactor | test | style | perf`
- 커밋 본문은 한국어로 작성한다.
- git identity 는 저장소 로컬 설정으로 고정되어 있다: `presenty1897 / presenty1897@gmail.com`
- 위 타입 목록은 `commitlint.config.mjs` 의 `type-enum` 과 **동일해야 한다.** `commit-msg` 훅이
  이 목록으로 커밋을 거부한다. `ci` · `build` · `revert` 는 쓰지 않으며 CI 작업도 `chore` 다.
  한쪽을 고치면 반드시 다른 쪽도 고친다.
- 커밋 훅은 `pnpm install` 이 설치한다. 훅 우회 방법은 README 의 "개발 워크플로" 절 참조.
- **커밋·PR 에 붙는 링크는 전부 다른 사람이 열 수 있어야 한다.** 계정에 묶인
  `https://claude.ai/code/session_...` 링크는 붙이지 않는다 (D-211). 커밋 트레일러는
  `Co-Authored-By: Claude <모델> <noreply@anthropic.com>` 한 줄이고, PR 본문 끝에는 저장소
  안 문서로 가는 `../blob/main/...` 링크가 붙는다. **모델 이름은 고정하지 않는다** — 실제
  쓰인 모델로 자동으로 채워져야 나중에도 맞는 기록이 된다.
- **그래서 판단 근거는 저장소 안에 남긴다.** 대화를 통째로 옮기는 것이 아니라 남아야 할 것만
  정리한다 — 결정은 `docs/decisions/`, 작업의 목적·설계·검증은 TASK 문서, 검증 결과는 PR 본문.
  PR 을 읽는 사람이 알아야 할 것은 본문과 `../blob/main/...` 로 닿는 곳에 전부 있어야 하고,
  `.github/pull_request_template.md` 가 그 뼈대를 준다.
  트레일러가 무엇인지는 README 의 "커밋 이력 읽는 법" 절이 설명한다.

## 4. 문서 기반 진행 원칙 (중요)

이 프로젝트는 **문서 승인 → 구현** 순서로 진행한다.

1. 새 작업은 먼저 TASK 문서로 계획을 작성한다. (템플릿: `docs/tasks/TASK-TEMPLATE.md`)
2. 사용자가 검토하고 **승인**하면 그때 구현을 시작한다.
3. **승인 전에는 구현 코드를 작성하지 않는다.** 스캐폴딩·실험이 필요하면 먼저 물어본다.
4. 구현 중 계획이 바뀌면 코드보다 **문서를 먼저 갱신**한다.

### 문서 구조

```
docs/
├── decisions/
│   ├── DECISIONS.md              ← 현재 유효한 최종 결정만. 작업 전 필독
│   └── YYYY-MM-DD-session-NN.md  ← 세션별 원본 이력 (논의 과정·근거·폐기안)
├── design/                       ← 항상 최신 상태를 유지하는 설계 문서
│   ├── pages.md                  앱별 페이지 목록, 라우팅, 밀도 3단계
│   ├── erd.md                    데이터 모델과 관계, 설계 근거
│   ├── state-machines.md         주문·재고·결제·클레임·정산·데모 상태 전이
│   └── pricing.md                금액 계산 순서와 환불 안분 규칙
└── tasks/
    ├── README.md                 마일스톤 요약 + 전체 100개 인덱스
    ├── QUALITY-GATES.md          공통 품질 게이트 (각 TASK 는 예외만 명시)
    ├── TASK-TEMPLATE.md
    └── M01-foundation/ ~ M15-polish/
        ├── README.md             해당 마일스톤 TASK 목록
        └── TASK-0001-*.md
```

### TASK 규칙

- **한 TASK = 하나의 작업 목적.** 여러 목적이 섞이면 쪼갠다. 반나절~하루, 커밋 5~15개가 기준이다.
- 번호는 **전역 4자리 평면 번호**다. 디렉터리는 그룹핑만 담당하므로, 마일스톤이 바뀌어 파일을 옮겨도 번호는 유지한다.
- **M01~M15 의 TASK 100개가 이미 작성되어 있다.** 새 TASK 를 만들기 전에 기존 문서에 해당 작업이 있는지 먼저 확인한다.
- 품질 게이트는 `docs/tasks/QUALITY-GATES.md` 를 참조하고 **예외만** 각 TASK 에 적는다. 게이트 표를 복사하지 않는다.
- 커버리지 게이트(80%)는 **M05 부터** 적용한다.
- **6장 완료 기준(Definition of Done)은 필수**다. "구현 완료", "정상 동작" 같은 주관적 표현은 쓰지 않고, 각 기준에 **측정 방법과 목표값**을 적는다.
  (예: `pnpm typecheck` error 0 / Lighthouse a11y 90점 이상 / API p95 300ms 이하)
- 기준을 **전부 충족하기 전에는 상태를 `완료` 로 바꾸지 않는다.**
- 완료 시 `docs/tasks/README.md` 와 마일스톤 `README.md` **두 곳**의 인덱스를 갱신한다.

### 구현 중 설계 변경이 필요할 때

```
문제 발견 → 해당 작업 중단 → 설계 문서(docs/design/, DECISIONS.md) 수정
          → 영향받는 TASK 문서 수정 → 사용자 승인 → 재개
```

**코드를 먼저 고치고 문서를 나중에 맞추지 않는다.** 문서가 실제와 어긋나기 시작하면 이 체계 전체가 무의미해진다.

### 설계 문서 규칙

- `docs/design/` 은 `DECISIONS.md` 와 같은 원칙으로 운영한다 — **현재 상태만 담고 변경 이력을 남기지 않는다.**
- 화면·스키마·상태 전이·금액 규칙이 바뀌면 **해당 TASK 완료 기준(D4)에 갱신을 포함**한다.
- 구현 시작 후 DB 의 단일 출처는 `schema.prisma` 다. `erd.md` 는 관계도와 설계 근거를 맡고, 컬럼 타입을 두 곳에 적지 않는다.

### 결정 이력 규칙

- 세션에서 결정이 나오면 **세션 파일에 `D-NNN` 으로 기록한 뒤 `DECISIONS.md` 의 해당 항목을 갱신**한다.
- 세션 파일은 덮어쓰지 않고 추가한다. `DECISIONS.md` 는 항상 최신 상태로 덮어쓴다.
- 결정이 번복되면 세션 파일에 "D-NNN 대체" 로 이력을 남기고 `DECISIONS.md` 에서는 옛 내용을 지운다.

## 5. 기술 스택

| 영역 | 선택 |
| --- | --- |
| 저장소 형태 | pnpm workspace **모노레포** |
| 프론트엔드 | **Next.js** (App Router) + TypeScript × **3개 앱** |
| 백엔드 | **NestJS** + TypeScript (단일 API) |
| DB | **PostgreSQL** + Prisma |
| 검색 | **Meilisearch** (상품 변경 이벤트 기반 인덱싱) |
| 이미지 | **Cloudflare R2** (S3 호환, presigned URL 직접 업로드) |
| 결제 | **가상 카드**(자체) + **토스페이먼츠 테스트** 2종, `PaymentProvider` 로 추상화 |
| 배송 | 도메인·상태 전이는 실제와 동일, 운송·추적은 **가상 처리** |
| 인증 | **Google OAuth 2.0** + JWT (access + refresh, refresh 는 httpOnly 쿠키) |
| 배포 | Vercel × 3 + Railway/Render(api, postgres, meilisearch) + R2 |
| 원격 | GitHub 공개 저장소 |

### 모노레포 레이아웃

```
apps/
├── api/        NestJS — REST API
├── shop/       구매자   (포트 3000, shop.<도메인>)
├── seller/     판매자   (포트 3001, seller.<도메인>)
└── admin/      관리자   (포트 3002, admin.<도메인>)
packages/
├── shared/     공용 타입 · zod 스키마 · API 클라이언트
├── api-mocks/  프론트 테스트용 API 대역 (msw). 프로덕션 번들에 들어가지 않는다
├── config/     eslint / tsconfig / prettier / vitest 프리셋
└── ui/         공통 UI 컴포넌트
```

- 프론트와 API 사이의 타입은 `packages/shared` 를 단일 출처로 삼는다.
- **세 앱의 세션은 독립이다.** 쿠키에 `Domain` 을 지정하지 않는다. 이 덕분에 세 역할을 탭 3개로 동시에 열 수 있다.

## 6. 작업 시 지켜야 할 것

- 사용자와의 대화 언어는 **한국어**.
- 코드 주석/식별자는 영어, 사용자 노출 문구는 한국어를 기본으로 한다.
- 결제는 **토스페이먼츠 테스트 키**로 실제 연동한다(실 결제 아님). 배송은 도메인·상태 전이를 실제와 동일하게 구현하되 운송사 연동 없이 **가상 처리**한다.
- 데모 계정은 **1인당 임시 계정을 발급**하고 일정 시간 후 계정과 생성 데이터를 자동 삭제한다. 상품 카탈로그는 공용, 장바구니/주문/리뷰 등 개인 데이터는 격리한다.
- 다국어는 **구조만 잡고 한국어/KRW 를 우선**한다. UI 문구는 메시지 파일로 분리하고 금액은 통화 정보를 포함한 값으로 모델링한다. (문구 하드코딩 금지)
- 상품 표현 3단계(미니멀↔맥시멀)는 **사용자가 토글**한다. 판매자별 강제 템플릿이 아니다.
- **`packages/ui` 에 컴포넌트를 추가하면 스토리를 함께 쓴다** (`packages/ui/stories/components/`). 나중에
  몰아서 쓰지 않는다 — 스토리 없는 컴포넌트는 밀도 3단계에서 확인된 적이 없고, 모든 스토리에 axe 를
  돌리는 `test/story-a11y.spec.tsx` 의 대상에서도 빠진다. 즉 **접근성 게이트를 통과하지 않은 채 머지된다.**
  컴포넌트를 추가하는 TASK 는 이것을 완료 기준에 포함한다 (TASK-0104).
- 금액은 **정수(원 단위)** 로 다룬다. 부동소수 연산 금지. 안분 시 잔여를 버리지 않는다.
- 주문·결제·정산에 관련된 값은 **스냅샷으로 남긴다.** 상품명·가격이 바뀌어도 과거 주문서는 그대로여야 한다.
- 잔액이 있는 것(재고·적립금·가상카드)은 **원장 테이블**을 둔다. 현재값은 원장의 결과이며 대사가 가능해야 한다.
- 실제 브랜드명·상표를 데이터에 사용하지 않는다. 가상 브랜드명을 생성해 쓴다.
- 비밀값은 커밋하지 않는다. `.env.example` 만 커밋한다.
