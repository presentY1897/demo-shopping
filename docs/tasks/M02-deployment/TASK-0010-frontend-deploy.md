# TASK-0010: 프론트 배포 (Vercel × 3)

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M02 배포 파이프라인 |
| 상태 | 완료 |
| 작성일 | 2026-09-02 |
| 브랜치 | `chore/frontend-deploy` |
| 선행 작업 | TASK-0008, TASK-0009 |

## 1. 목적

모노레포 한 저장소에서 Vercel 프로젝트 3개를 각각 다른 앱으로 빌드해 서브도메인에 배포한다.

## 2. 범위

### 포함
- Vercel 프로젝트 3개 생성 (shop / seller / admin), 루트 디렉터리와 빌드 명령 지정
- 각 프로젝트에 서브도메인 연결
- 앱별 환경변수 (`NEXT_PUBLIC_API_URL`)
- API 의 CORS 허용 오리진에 세 도메인 등록
- 앱별 변경 감지 (관련 없는 앱은 재배포하지 않음)

### 제외
- 자동 배포 규칙 정교화 (TASK-0012)
- 프리뷰 배포 환경변수 분리 (TASK-0012)

## 3. 요구사항

- [x] 세 서브도메인에서 각 앱이 뜨고 API 헬스체크 결과를 표시한다
- [x] 한 앱만 수정하면 그 앱만 재배포된다
- [x] 허용되지 않은 오리진의 요청이 CORS 로 차단된다

## 4. 설계

| 프로젝트 | Root Directory | 도메인 |
| --- | --- | --- |
| shopping-shop | `apps/shop` | `shop.<도메인>` |
| shopping-seller | `apps/seller` | `seller.<도메인>` |
| shopping-admin | `apps/admin` | `admin.<도메인>` |

- 빌드: `pnpm --filter @shopping/<app>... build` (의존 패키지 포함)
- 변경 감지: Vercel `Ignored Build Step` 에 아래 명령을 넣는다

### 4.1 앱별 변경 감지 — `scripts/vercel-ignore.mjs`

**이것이 없으면 한 PR 이 Vercel 프로젝트 넷을 모두 빌드한다.** TASK-0032 는 `apps/api` 15개
파일만 바꿨는데 shop·seller·admin·ui 가 전부 재배포됐고, 그날 Hobby 플랜의 일일 한도가
소진돼 **24시간 동안 배포가 막혔다.** PR 하나가 초기 push·rebase 후 force-push·머지 후
`main` 배포까지 합쳐 8~16회를 쓴다.

Vercel 대시보드 → 프로젝트 → Settings → Git → **Ignored Build Step**:

| 프로젝트 | 명령 |
| --- | --- |
| `shopping-shop` | `node scripts/vercel-ignore.mjs apps/shop` |
| `shopping-seller` | `node scripts/vercel-ignore.mjs apps/seller` |
| `shopping-admin` | `node scripts/vercel-ignore.mjs apps/admin` |
| Storybook(`demo-shopping-ui`) | `node scripts/vercel-ignore.mjs packages/ui` |

**Vercel 의 종료 코드는 뒤집혀 있다 — `0` 이 건너뛰기, 0 이 아니면 빌드다.** 스크립트의 모든
`process.exit` 에 어느 쪽인지 주석을 달아 둔 이유다.

**판단이 서지 않으면 빌드한다.** 인자가 없거나 `git diff` 가 실패하면(첫 배포라
`VERCEL_GIT_PREVIOUS_SHA` 가 비었거나 얕은 클론일 때) 빌드로 떨어진다. 불필요한 빌드는
배포 1회를 쓰지만, **잘못 건너뛴 빌드는 아무것도 배포하지 않은 채 성공한 것처럼 보인다.**

**공용 경로는 열거한다.** `packages/`·`pnpm-lock.yaml`·`pnpm-workspace.yaml`·루트
`package.json`·`tsconfig.json`·`scripts/` 가 바뀌면 전부 빌드한다. 와일드카드로 뭉뚱그리지
않는 이유는, 어떤 프로젝트가 쓰지 않는 디렉터리가 재빌드를 강요하면 안 되고 그것을 지키는
방법은 **쓰는 것을 명시적으로 적는 것**뿐이기 때문이다.

## 5. 구현 계획

1. Vercel 프로젝트 3개 생성, 모노레포 설정
2. 빌드 명령·설치 명령 지정 (pnpm workspace 인식)
3. 환경변수 등록
4. 서브도메인 연결
5. API CORS 오리진 갱신 후 재배포
6. 변경 감지 스크립트 적용

## 6. 완료 기준

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 세 앱 배포 | 각 서브도메인 익명 접속 | 200, 페이지 렌더 | [x] `구매자 앱`·`판매자 콘솔`·`관리자 콘솔`, TLS 1.3 |
| F2 | API 연결 | 헬스체크 응답 | API/DB/검색 상태 표시 | [x] `api.demo-shopping.com/api/v1/health` |
| F3 | CORS 허용 | 세 오리진으로 실요청 | CORS 오류 0건 | [x] 각각 자기 오리진이 `access-control-allow-origin` 으로 반향 |
| F4 | CORS 차단 | 등록되지 않은 오리진에서 호출 | 차단됨 | [x] `https://evil.example.com` → 허용 헤더 **없음** |
| F5 | 선택적 재배포 | 실제 커밋에 판별 스크립트 적용 | 관련 없는 앱은 skip | [x] 아래 표 |
| F6 | 공용 패키지 변경 | 〃 | 세 앱 모두 재빌드 | [x] 아래 표 |

#### F5·F6 — 실제 커밋으로 검증한 판정표

Vercel 이 도는 모양 그대로 재현했다. 각 커밋에 **분리된 체크아웃**을 만들고
`VERCEL_GIT_PREVIOUS_SHA=<그 커밋의 부모>` 로 스크립트를 실행했다.

| 커밋이 바꾼 것 | shop | admin | seller | ui(Storybook) |
| --- | --- | --- | --- | --- |
| `apps/shop` 만 | **빌드** | skip | skip | skip |
| `apps/api` 만 | skip | skip | skip | skip |
| `packages/shared` | **빌드** | **빌드** | **빌드** | **빌드** |

> **처음 두 번의 측정은 틀렸다.** 스크립트가 `base..HEAD` 를 보는데 현재 브랜치 끝에서
> 실행해 범위가 과했고, 그다음엔 옛 커밋에 스크립트가 없어 실행 자체가 실패해 전부
> "빌드"로 나왔다. **실패는 곧 빌드**라는 설계(아래) 때문에 겉보기로는 그럴듯해 보였다 —
> 판정표가 전부 `빌드` 일 때 그것이 정상인지 고장인지 구분되지 않는다는 뜻이므로,
> **skip 이 나와야 하는 줄이 실제로 skip 인지**를 확인하는 것이 이 표의 핵심이다.

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:
- **Q5(커버리지) 면제** — M05 부터 적용
- **2장 화면 게이트 해당 없음** — 확인용 임시 페이지, M03 에서 교체
- **3~4장 해당 없음**

### 6.3 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | [x] |
| D4 | 프론트 환경변수 `.env.example` 반영 | [x] `NEXT_PUBLIC_API_URL` 이 이미 있다 |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | Vercel 무료 플랜의 프로젝트·빌드 제한 | 프로젝트 3개는 무료 범위. 빌드 시간이 문제되면 변경 감지로 절감 |
| R2 | pnpm workspace 를 Vercel 이 인식하지 못함 | `installCommand` 를 루트 기준으로 명시 |

## 8. 확정된 버전

해당 없음.

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
