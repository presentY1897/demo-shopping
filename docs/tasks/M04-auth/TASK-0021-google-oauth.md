# TASK-0021: Google OAuth 로그인

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M04 인증·계정 |
| 상태 | 승인됨 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/google-oauth` |
| 선행 작업 | TASK-0020 |

## 1. 목적

Google OAuth 2.0 인가 코드 흐름을 구현한다. 이메일/비밀번호 가입은 만들지 않으므로 이것이 유일한 실계정 로그인 경로다.

## 2. 범위

### 포함
- ~~Google Cloud 프로젝트·OAuth 클라이언트 생성~~ — **이미 완료됐다**(2026-09-03, [`OWNER-CHECKLIST.md`](../../OWNER-CHECKLIST.md) A-7). 테스트 모드 유지, 게시는 M15(D-209)
- 인가 코드 흐름 (authorize → callback → 토큰 교환 → 프로필 조회)
- 최초 로그인 시 `User` 생성 + `UserRole(BUYER)` 부여, 재로그인 시 조회
- `state` 파라미터로 CSRF 방지 — **httpOnly 쿠키에 보관**(4장)
- **복귀 계약** — 콜백이 어느 앱으로 무엇을 실어 돌아가는지. TASK-0022·0023 이 이것을 소비한다
- 로그인 실패·취소 처리
- Google 호출을 **포트 뒤에** 두기 (`GOOGLE_OAUTH`), 환경변수 세트 검증

### 제외
- **JWT 발급 · 세션 (TASK-0022)** — 이 TASK 의 콜백은 세션을 만들지 않는다. 4장 「이 TASK 가 끝나도
  로그인은 성립하지 않는다」 참조
- `AnonymousPrincipalResolver` 교체 → TASK-0022. 이 TASK 는 인증된 요청을 만들지 않으므로 리졸버를
  바꿀 것이 없다
- 로그인 화면 UI (TASK-0023)
- 다른 소셜 로그인
- **Vercel 프리뷰 환경의 OAuth** → R3
- 새 도메인 오류 코드 → 4장 「실패는 봉투가 아니라 리다이렉트로 답한다」

## 3. 요구사항

- [ ] Google 계정으로 로그인하면 사용자가 생성되거나 조회된다
- [ ] 신규 사용자에게 `BUYER` 역할이 같은 트랜잭션에서 부여된다
- [ ] `state` 검증에 실패하면 로그인이 거부된다
- [ ] 세 앱이 각각 **자기 오리진으로** 복귀한다 (콜백 URL 자체는 API 하나다)
- [ ] 복귀 대상은 허용 목록에서 고른다 — 임의 주소로 리다이렉트되지 않는다
- [ ] 사용자가 동의를 취소하면 오류 화면 없이 로그인 페이지로 돌아간다
- [ ] Google 자격증명이 없는 환경에서도 API 가 정상 기동한다 (해당 엔드포인트만 503)

## 4. 설계

```
seller → GET /api/v1/auth/google?app=seller  → Google 동의 화면
                                              ↓
       ← GET /api/v1/auth/google/callback?code&state
         ① state 쿠키 대조   ② 코드→토큰 교환   ③ 프로필 조회
         ④ User 조회/생성 + UserRole(BUYER)
         ⑤ JWT 발급 ─────────────────────────── TASK-0022 가 채운다
         ⑥ 302 {앱 오리진}/login?status=ok
```

- 신규 사용자에게는 기본 역할 BUYER 를 부여한다. SELLER_OWNER 는 입점 승인(TASK-0108), ADMIN 계열은 수동 부여만 가능하다

### 이 TASK 가 끝나도 로그인은 성립하지 않는다

⑤가 TASK-0022 의 것이므로 **콜백은 세션을 만들지 않는다.** 끝났을 때 남는 것은 `User` 행과
`UserRole(BUYER)` 행, 그리고 브라우저를 앱으로 돌려보내는 302 뿐이다. 다음 세션이 "로그인이
되는데 왜 로그인 상태가 아니냐" 고 묻지 않도록 여기 적어 둔다.

**그래서 완료 기준의 측정 수단도 브라우저가 아니다.** F1~F7 은 전부 통합 테스트가 HTTP 수준에서
증명한다 — 302 의 `Location`, `Set-Cookie`, DB 행. 화면으로 확인하는 것은 TASK-0023 이 로그인
페이지를 만든 뒤다.

### 콜백은 앱별이 아니라 API 하나다

Google 콘솔에 등록된 리다이렉트 URI 는 **둘뿐**이다.

```
http://localhost:4000/api/v1/auth/google/callback
https://api.demo-shopping.com/api/v1/auth/google/callback
```

앱은 authorize 의 `?app=` 으로 들어오고, **콜백은 그것을 쿼리가 아니라 state 쿠키에서 읽는다.**
쿼리에서 읽으면 공격자가 복귀 앱을 바꿔치기할 수 있다.

### state 는 DB 가 아니라 httpOnly 쿠키에 둔다

`schema.prisma` 는 TASK-0032·0020 이 소유하고 이 TASK 는 스키마를 바꾸지 않는다(2장 제외).
쿠키로 두면 테이블이 필요 없고, 만료 정리 배치도 필요 없다.

| 속성 | 값 | 이유 |
| --- | --- | --- |
| `HttpOnly` | 예 | 스크립트가 읽을 이유가 없다 |
| `Domain` | **미지정** | D-028. 지정하면 서브도메인 간 공유되어 앱별 독립이 깨진다 |
| `SameSite` | **`Lax`** | 콜백은 Google 에서 오는 **top-level cross-site GET** 이다. `Strict` 면 쿠키가 실리지 않아 모든 로그인이 state 불일치로 실패한다 |
| `Path` | `/api/v1/auth/google` | 다른 요청에 딸려 나갈 이유가 없다 |
| `Max-Age` | 600초 | 동의 화면에 머무는 시간 |
| `Secure` | 운영에서만 | 로컬은 http 다 |

쿠키 값은 **난수 state 와 `app` 을 함께** 담는다. 콜백은 쿼리의 `state` 와 쿠키의 것을 상수 시간
비교하고, 성공·실패와 무관하게 **즉시 쿠키를 지운다**(1회용 — 재사용 공격 차단).

### 복귀 주소는 새 환경변수를 만들지 않는다

이미 있는 `corsOrigins` 가 **정확히 정당한 복귀 대상의 집합**이다. 거기서 고르면 open redirect 가
구조적으로 불가능해진다 — 목록에 없는 주소는 애초에 만들어지지 않는다.

| 환경 | `corsOrigins` 출처 | 앱 → 오리진 |
| --- | --- | --- |
| 로컬 | `derived-env.ts` 가 PORT_OFFSET 에서 파생 | 포트로 고른다 (`BASE_PORTS[app] + PORT_OFFSET`) |
| 운영 | `render.yaml` 의 `CORS_ORIGINS` | 호스트 첫 라벨로 고른다 (`shop.` · `seller.` · `admin.`) |

고르지 못하면 그 앱으로는 **로그인을 시작할 수 없다**(authorize 가 400). 조용히 기본값으로
떨어지지 않는다 — `CORS_ORIGINS` 를 빠뜨렸을 때 조용히 localhost 가 되던 것과 같은 실수를
반복하지 않기 위해서다(`.env.example` 배포 대조표).

### Google 은 포트 뒤에 둔다 — 라이브러리를 쓰지 않는다

필요한 것은 HTTPS 호출 둘뿐이다: 토큰 교환(`POST oauth2.googleapis.com/token`)과 프로필
조회(`GET .../oauth2/v3/userinfo`). 문서 흐름도의 ②③ 이 그대로 이 둘이다.

```ts
export interface GoogleOAuthClient {
  exchangeCode(code: string, redirectUri: string): Promise<GoogleTokens>
  fetchProfile(accessToken: string): Promise<GoogleProfile>
}
```

`GOOGLE_OAUTH` 심볼로 주입하고 `FetchGoogleOAuthClient` 가 실제 구현이다. **QUALITY-GATES 6장이
"모킹 대상은 전부 포트 뒤에 둔다" 고 했고 `OBJECT_STORAGE`(R2)가 그 선례다.** 테스트는 포트를
갈아끼우므로 `fetch` 를 전역에서 가로챌 필요가 없다.

**id_token 서명 검증을 하지 않는다.** 프로필을 `userinfo` 로 받으므로 JWT 를 다룰 일 자체가 없다.
라이브러리를 넣으면 모킹 대상이 라이브러리 내부가 되어 대역이 더 지저분해진다.

### 자격증명은 세트로 검증한다

`GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` (이름은 **D-209 확정**).

| 상태 | 동작 |
| --- | --- |
| 둘 다 있음 | 활성 |
| 둘 다 없음 | **정상 기동**, 두 엔드포인트만 503 |
| 하나만 있음 | **부팅 거부** — 반쯤 설정된 상태가 런타임까지 살아남지 않는다 |

R2 의 `storage-config.ts` 와 같은 패턴이다. **이게 없으면 CI 가 깨진다** — `.github/workflows/ci.yml`
은 Google 시크릿을 주입하지 않는다.

### 신규 사용자는 한 트랜잭션이다

`User` INSERT 와 `UserRole(BUYER)` INSERT 가 같은 트랜잭션이다. `User_google_identity_check` 가
"살아있는 실계정에는 `googleSub` 가 있다" 를 강제하므로 같은 문장에서 채운다.

**동시 최초 로그인은 DB 가 막는다.** 같은 `googleSub` 로 두 요청이 동시에 오면 부분 유니크 인덱스
`User_googleSub_active_key` 가 한쪽을 떨어뜨리고, 진 쪽은 조회로 되돌아가 같은 사용자를 얻는다.
애플리케이션의 "있나 확인 후 만들기" 는 이 경합을 막지 못한다.

### 실패는 봉투가 아니라 리다이렉트로 답한다

콜백은 **브라우저가 직접 여는 주소**다. 오류 봉투(JSON)를 반환하면 사람이 raw JSON 을 본다 —
F5("오류 화면 없이 로그인 페이지로 복귀")가 금지하는 것이 정확히 그것이다.

| 결과 | `Location` |
| --- | --- |
| 성공 | `{앱 오리진}/login?status=ok` |
| 동의 취소 | `{앱 오리진}/login?status=cancelled` |
| 실패 | `{앱 오리진}/login?status=error&reason=<reason>` |
| 역할 없음 | 위 성공에 `&notice=no_role` 이 덧붙는다 |

`reason` 어휘(`state_mismatch` · `exchange_failed` · `profile_failed` · `not_configured`)는
`packages/shared` 에 zod enum 으로 두어 TASK-0023 이 같은 목록을 읽게 한다.

**`domainErrorCodes` 에 넣지 않는다.** 그것은 JSON 오류 봉투의 어휘이고, 항목을 더하면 각 앱의
`Record<UserFacingErrorCode, string>` 카탈로그가 전수 검사로 `pnpm typecheck` 를 깨뜨린다
(TASK-0032 4.10). 이 TASK 는 백엔드이고 화면 게이트가 없으므로 프론트 두 앱의 카탈로그를 건드리는
것은 범위를 넘는다. 리다이렉트 파라미터는 봉투가 아니므로 그 전수 검사에 걸리지 않는다.

state 불일치처럼 **복귀 앱조차 알 수 없는 경우**에는 리다이렉트할 곳이 없다. 그때만 400 을
봉투로 답한다 — 브라우저에 JSON 이 보이지만, 그 상태는 정상 흐름에서 발생하지 않는다.

### 두 엔드포인트는 `@PublicEndpoint` 다

`PermissionGuard` 가 전역 deny-by-default 라, `@RequirePermission` 도 `@PublicEndpoint` 도 없는
핸들러는 **500** 이 된다(`permission.guard.ts`). 로그인 이전 경로이므로 `@PublicEndpoint` 를 붙인다.

## 5. 구현 계획

1. `packages/shared` 에 복귀 계약 스키마(`status` · `reason` · `notice`) + `AppId` 재사용
2. env 스키마에 `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` 세트 검증 + `.env.example` 반영
3. 앱 → 오리진 해석 (`corsOrigins` 에서 고르는 순수 함수, 분기 100% 대상)
4. `GoogleOAuthClient` 포트 + `FetchGoogleOAuthClient` 구현
5. authorize 엔드포인트 + state 쿠키 발급
6. callback 엔드포인트 — state 대조, 토큰 교환, 프로필 조회
7. User 조회/생성 + `UserRole(BUYER)` 한 트랜잭션, 경합 시 조회로 되돌기
8. 실패·취소 경로를 전부 리다이렉트로
9. 실제 PostgreSQL 통합 테스트 (Google 은 포트 대역)

## 6. 완료 기준

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 최초 로그인 | 신규 `googleSub` 로 콜백 1회 | `User` 1행 + `UserRole(BUYER)` 1행, `lastLoginAt` 갱신 | [ ] |
| F2 | 재로그인 | 같은 `googleSub` 로 콜백 재호출 | User 행 수 불변, 역할 중복 부여 0건 | [ ] |
| F3 | CSRF 방지 | ① state 쿼리 변조 ② 쿠키 없이 콜백 ③ 같은 state 두 번 | 셋 다 거부, User 생성 0건 | [ ] |
| F4 | 앱별 복귀 | `app=shop\|seller\|admin` 각각 로그인 | `Location` 이 각 앱 오리진, 셋이 서로 다름 | [ ] |
| F5 | 취소 처리 | 콜백에 `?error=access_denied` | 302 `.../login?status=cancelled`, 봉투 응답 0건 | [ ] |
| F6 | 권한 없는 앱 | BUYER 만 있는 계정으로 `app=admin` | `Location` 에 `notice=no_role`. **화면 표시는 TASK-0023** | [ ] |
| F7 | 동시 최초 로그인 | 같은 `googleSub` 로 콜백 2건 동시 | User 1행만 생성, 둘 다 같은 사용자로 성공 (A7) | [ ] |
| F8 | 미설정 기동 | 두 환경변수 없이 부팅 후 호출 | 기동 성공, 두 엔드포인트만 503 | [ ] |
| F9 | 반쪽 설정 | `GOOGLE_CLIENT_ID` 만 두고 부팅 | 부팅 거부 + 어느 변수인지 메시지에 포함 | [ ] |
| F10 | open redirect | 허용 목록에 없는 앱으로 authorize | 400, 외부 주소로 리다이렉트 0건 | [ ] |

> **F6 을 다시 쓴 이유.** 원문은 "권한 없음 안내 표시" 였는데 이 TASK 에는 화면이 없다(2장 화면
> 게이트 해당 없음, UI 는 TASK-0023). 표시를 측정 대상으로 두면 **영원히 충족할 수 없는 기준**이
> 된다. 그래서 이 TASK 의 몫인 "복귀 URL 이 그 사실을 실어 보낸다" 로 바꾸고, 표시는 TASK-0023 이
> 받는다.

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용.

| 장 | 적용 | 비고 |
| --- | --- | --- |
| 1장 코드 게이트 | Q1~Q7 전부 | 커버리지 80%(M05 부터지만 M04 인 이 TASK 도 대상 파일이 생기므로 지킨다) |
| **2장 화면 게이트** | **해당 없음** | 사용자 대상 화면이 없다. UI 는 TASK-0023 |
| 3장 API 게이트 | **A1 · A2 · A6 적용** | 아래 |
| **4장 데이터 게이트** | **해당 없음** | `schema.prisma` 무변경 |
| 5장 계약 게이트 | **C1** | 복귀 계약 어휘를 `packages/shared` 에 둔다. C2·C3 은 소비자(0023)의 몫 |
| 7장 문서 게이트 | D1 · D4 | |

- **A3 · A4 해당 없음** — 인증 이전 경로다.
- **A5 해당 없음** — 목록 조회가 없다.
- **A6 적용** — 원문에 없었으나 실 DB 를 쓰는 서비스이므로 받는다. Google 만 포트로 대역화한다
  (QUALITY-GATES 6장: "외부 시스템(토스·Google·R2·Meilisearch)만 모킹").
- **A7 적용** — 원문에 없었다. 같은 `googleSub` 의 동시 최초 로그인은 **멱등이 걸린 경로**이고,
  부분 유니크 인덱스가 실제로 막는지는 동시 호출로만 증명된다. F7 이 그것이다.

### 6.3 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | [ ] |
| D4 | `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` 를 `.env.example` 과 배포 대조표에 반영 | [ ] |
| D6 | 프리뷰 OAuth(R3)를 `docs/HANDOFF.md` 3절에 주인 미정으로 남긴다 | [ ] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | ~~리다이렉트 URI 가 환경마다 달라 관리 부담~~ | **해소됐다.** 콜백이 API 단일 URL 이라 등록 대상은 로컬·운영 둘뿐이고 이미 등록돼 있다. 앱 구분은 state 쿠키가 한다 (4장) |
| R2 | Google 계정 이메일 변경 시 식별 | `googleSub` 를 식별자로 쓰고 이메일은 표시용으로만 저장 |
| R3 | **Vercel 프리뷰에서는 로그인이 성립하지 않는다** — Google 이 와일드카드 리다이렉트를 허용하지 않는데 프리뷰 URL 은 매번 바뀐다 | **이 TASK 에서 풀지 않는다.** 프리뷰용 API 배포가 없어(Render 는 운영만) 프리뷰 프론트가 운영 API 를 부르면 콜백이 운영 앱으로 돌아간다 — 배포 구성(TASK-0012 영역)이 먼저다. D6 으로 HANDOFF 에 남긴다 |
| R4 | 콜백이 오류를 리다이렉트로만 답해 디버깅이 어렵다 | `reason` 을 쿼리로 실어 보내고, 서버 로그에는 `requestId` 와 함께 원인을 남긴다. 사람이 보는 화면과 운영자가 보는 로그를 분리한다 |

## 8. 확정된 버전

**새 의존성 없음.** OAuth 클라이언트 라이브러리를 쓰지 않는다 — 필요한 것이 HTTPS 호출 둘뿐이고,
`GoogleOAuthClient` 포트 뒤의 `fetch` 구현으로 충분하다. 근거는 4장 「Google 은 포트 뒤에 둔다」.

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-03 | D-208 레이어 분할에 따라 참조 갱신 — 입점 승인은 TASK-0026 → **TASK-0108** |
| 2026-09-04 | **착수 전 설계 확정.** 코드·문서 대조에서 드러난 것들을 반영했다 — 콜백이 앱별이 아니라 API 단일 URL 이라는 것(R1 해소), state 를 쿠키에 두는 이유와 `SameSite=Lax` 가 필수인 이유, 복귀 주소를 `corsOrigins` 에서 고르는 이유, 라이브러리 없이 포트 뒤 `fetch` 로 가는 결정(8장), 자격증명 세트 검증(CI 가 시크릿을 안 주므로 필수), 실패를 오류 봉투가 아니라 리다이렉트로 답하는 이유. **F6 을 화면 표시에서 복귀 URL 로 다시 썼다** — 이 TASK 에 화면이 없어 원문 기준은 충족할 수 없었다. F7~F10 추가, A6·A7 을 적용으로 정정, R3(프리뷰 OAuth) 신설 |
