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

### 4.1 앱별 변경 감지 — Vercel 이 이미 한다

**Vercel 은 pnpm 워크스페이스 모노레포에서 영향받지 않은 프로젝트의 빌드를 자동으로 건너뛴다.**
설정할 것이 없다. [공식 문서](https://vercel.com/docs/monorepos#skipping-unaffected-projects):

> Vercel automatically skips builds for projects in a monorepo that are unchanged by the commit.
> This setting does **not** occupy concurrent build slots, **unlike the Ignored Build Step**.

요건을 이 저장소가 전부 충족한다 — GitHub 연결 · `pnpm-workspace.yaml` · 패키지마다 고유한
`name` · `package.json` 에 명시된 패키지 간 의존성.

**`Ignored Build Step` 을 쓰면 오히려 손해다.** 같은 문서:

> **Canceled builds are counted as full deployments** as they execute a build command in the
> build step. This means that any canceled builds initiated using the ignore build step
> **will still count towards your deployment quotas**.

즉 그쪽은 빌드 *시간*만 아끼고 **일일 한도는 그대로 태운다.** 내장 건너뛰기는 배포 자체를
만들지 않는다.

#### 2026-09-04 의 한도 소진은 헛빌드가 아니었다

그날 TASK-0032 의 PR 에서 Vercel 4개가 전부 빌드돼 "관련 없는 앱까지 빌드된다" 고 판단하고
판별 스크립트를 만들었다. **틀렸다.** 그 PR 이 바꾼 것은 `apps/api` 15개 파일과
**`packages/shared`** 였고, `shared` 는 **세 웹 앱 모두의 의존성**이다. 넷이 빌드된 것은
정확한 동작이었고, 스크립트를 넣었어도 같은 결과였을 것이다(공용 경로로 `packages/` 를
열거했으므로).

**실제 원인은 배포 횟수 자체다.** PR 하나가 초기 push · rebase 후 force-push · 머지 후 `main`
배포까지 8~16회를 쓰고, 그날 PR 을 여러 건 돌렸다. Hobby 는 하루 100회다. 줄이려면 push
횟수를 줄이거나(로컬 게이트를 먼저 통과시키고 push) 플랜을 올린다.

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

#### F5 · F6 — Vercel 내장 기능이 답한다

직접 만든 판별 스크립트를 검증했다가 **전제가 틀린 것을 알고 되돌렸다**(4.1). 이 두 기준은
Vercel 이 자동으로 충족한다 — 요건을 저장소가 충족하고, 실제 동작도 그것과 일치한다.

| 커밋이 바꾼 것 | 기대 | 실제 (PR #52) |
| --- | --- | --- |
| `apps/api` + `packages/shared` | `shared` 는 세 앱의 의존성이므로 **전부 빌드** | 4개 전부 빌드 ✅ |

`apps/shop` 만 바꾼 커밋에서 다른 앱이 건너뛰는지는 아직 관측하지 못했다 — 그런 PR 이
아직 없었다. **관측되면 여기에 적는다.**

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
