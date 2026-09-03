# TASK-0105: 퍼미션 기반 권한 체계 (RBAC)

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M04 인증·계정 |
| 상태 | 완료 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/rbac` |
| 선행 작업 | TASK-0020 |

## 1. 목적

권한을 **퍼미션 단위**로 두고 역할에 매핑한다. 데모 계정 제한이 별도 장치가 아니라 **권한 체계의 일부**로 표현되게 하는 것이 핵심이다.

## 2. 범위

### 포함
- 퍼미션 상수 정의 (`packages/shared`)
- 역할 → 퍼미션 매핑 (코드 상수)
- `@RequirePermission()` 가드 — API 전 엔드포인트 적용
- **리소스 스코프 검사** — 퍼미션만으로 부족한 "자기 것만" 조건
- **데모 리소스 조건** — 데모 관리자는 데모 계정이 만든 데이터만 처리
- 역할 부여·회수 API (관리자)
- 권한 매트릭스 문서 자동 생성

### 제외
- 역할을 DB 에서 편집하는 화면 — 코드 상수로 충분하다
- 판매자 직원 계정 (범위 밖. `SELLER_OWNER` 라는 이름으로 확장 여지만 남긴다)
- **프론트 권한 훅 — 버튼 비활성 + 사유 툴팁 → TASK-0023 으로 이관** (2026-09-03).
  이 훅은 **로그인한 사용자의 퍼미션 목록**이 있어야 동작하는데 인증(TASK-0021·0022)이 아직 없다.
  또 `packages/ui` 는 TASK-0015 가 소유 중이다. TASK-0023 은 선행이 `0022, 0105` 이므로 그곳이 제자리다.
  판정 로직은 이 TASK 가 `@shopping/shared` 에 순수 함수로 넣어 두었고, 훅은 그것을 감싸기만 하면 된다.
- **인증 자체** (TASK-0021·0022). 이 TASK 는 "요청 사용자"를 **인터페이스로만** 정의하고,
  그 자리를 채우는 구현은 `AnonymousPrincipalResolver`(전부 익명) 하나로 둔다.

## 3. 요구사항

- [x] 권한 없는 호출이 403 으로 차단된다
- [x] 데모 관리자가 실계정·시드 데이터를 수정할 수 없다
- [x] 데모 관리자가 **데모 계정이 만든 데이터는 처리할 수 있다**
- [ ] 프론트에서 권한 없는 버튼이 비활성 + 사유가 표시된다 → **TASK-0023 에서 검증** (범위 이관)
- [x] `isDemo` 분기가 비즈니스 로직에 흩어지지 않는다

## 4. 설계

### 퍼미션

동사는 `read / write / delete / approve` 를 기본으로 하고, 그것으로 표현되지 않는 동작만 고유 동사를 쓴다
(`claim.handle` · `settlement.pay` · `seller.suspend` · `demo.manage`).

```
catalog.read      catalog.write     catalog.delete
product.read      product.write     product.delete
order.read        order.write
claim.read        claim.handle
coupon.read       coupon.write      coupon.delete
settlement.read   settlement.approve   settlement.pay
user.read         user.write        user.delete
seller.read       seller.approve    seller.suspend
demo.manage
```

퍼미션 이름은 `<리소스>.<동작>` 형태를 지킨다. 형식이 아니라 **동작이 읽기인지 아닌지를 코드가 판정**해야
하기 때문이다 — 데모 스코프 파생(아래)이 이 판정을 쓴다.

### 역할

| 역할 | 퍼미션 |
| --- | --- |
| `BUYER` | 공용 카탈로그 읽기 + 자기 주문·클레임·쿠폰·계정 (스코프 `own`) |
| `SELLER_OWNER` | 자기 스토어의 product·order·claim·coupon·settlement (스코프 `own`) |
| `ADMIN_OPERATOR` | 전체 read + catalog/product/coupon write + claim.handle + seller.approve |
| `ADMIN_SUPER` | 전부 (delete·settlement.pay·user.delete 포함) |
| `DEMO_ADMIN` | `ADMIN_OPERATOR` 에서 **파생**. 쓰기만 `demo` 로 좁히고 읽기는 그대로 |

전체 표는 손으로 적지 않는다. **`docs/design/permission-matrix.md` 가 코드에서 생성된다** (7절).

`DEMO_BUYER` / `DEMO_SELLER` 는 만들지 않는다. 소유권 스코프로 이미 제한되므로 일반 역할과 같다.

**`user.write` 는 `ADMIN_SUPER` 만 가진다.** 이 표에서 `user.write` 는 "계정을 관리한다"(역할 부여 포함)는
뜻이고, 이것을 `own` 스코프로 아무 역할에나 주면 **자기 계정에 스스로 `ADMIN_SUPER` 를 부여**할 수 있다 —
대상이 정말로 자기 계정이므로 스코프 검사도 통과한다. 자기 프로필 편집은 다른 능력이며 그 화면을 만드는
TASK-0027 에서 별도 퍼미션을 받는다. `authorize.spec.ts` 가 이 조건을 테스트로 고정한다.

### 리소스 스코프 — 퍼미션만으로 부족한 부분

퍼미션은 "무엇을 할 수 있나"만 답한다. "누구 것에"는 별도 조건이다.

| 스코프 | 의미 |
| --- | --- |
| `own` | 자기가 소유한 리소스만 (판매자 → 자기 스토어, 구매자 → 자기 주문) |
| `demo` | **데모 계정이 만든 리소스만** |
| `any` | 전부 |

```
SELLER_OWNER  product.write:own
ADMIN_OPERATOR product.write:any
DEMO_ADMIN    product.write:demo      ← 시드·실계정 상품은 못 건드린다
              seller.approve:demo     ← 데모 판매자의 신청만 승인 가능
```

**이 설계의 핵심**: 데모 제한이 `if (user.isDemo) throw` 같은 분기가 아니라 **스코프 값 하나**로 표현된다. 로직에 흩어지지 않는다.

판정은 **리소스의 소유 정보**만 본다.

```ts
interface ResourceOwnership {
  ownerUserId: string | null    // 계정 소유자. 시드·플랫폼 데이터는 null
  ownerSellerId: string | null  // 스토어 소유자
  ownerIsDemo: boolean          // 소유 계정이 데모인가. 시드는 false
}
```

`own` 은 둘 중 하나라도 맞으면 통과하고(스토어 소유 상품, 계정 소유 주문), **`null` 끼리는 절대 맞지 않는다** —
스토어가 없는 계정(`sellerId: null`)이 주인 없는 시드 데이터(`ownerSellerId: null`)를 자기 것으로
주장하지 못하게 하는 것이 이 검사의 핵심 분기다.

**요청 사용자는 자기가 데모인지 말하지 않는다.** 판정에 들어가는 것은 리소스의 `ownerIsDemo` 뿐이다.
데모 관리자가 제한되는 이유는 "요청자가 데모라서"가 아니라 **`DEMO_ADMIN` 역할의 그랜트에 `demo` 가 붙어
있어서**다. 그래서 권한 판정 함수에는 요청자의 데모 여부라는 입력이 아예 없다.

### `DEMO_ADMIN` 은 손으로 적지 않고 파생한다

`DECISIONS.md` 2장이 이 역할을 **등식**으로 적어 두었다 — "`DEMO_ADMIN` = `ADMIN_OPERATOR` + 스코프 `demo`".
그래서 코드도 등식으로 쓴다. `ADMIN_OPERATOR` 의 그랜트를 그대로 가져와 `any` 인 것 중 **쓰기만** `demo` 로
좁힌다. 읽기가 `any` 로 남는 것은 `erd.md` 1장의 "시드·실계정 데이터는 **조회만**" 을 그대로 옮긴 것이다.

두 벌로 적어 두면 운영자에게 퍼미션이 하나 늘어난 날 이쪽을 잊는다. 파생이면 잊을 것이 없다.

### 기본 거부

`@RequirePermission()` 도 `@PublicEndpoint()` 도 없는 핸들러는 **통과가 아니라 차단**이다.
빠뜨린 데코레이터가 무방비 엔드포인트를 배포하는 대신 403 과 에러 로그를 만든다. 그리고 그 전에
`endpoint-coverage.spec.ts` 가 모듈 그래프를 정적으로 걸어 CI 에서 빌드를 깨뜨린다.

열려 있어야 하는 엔드포인트는 **말로** 선언한다(`@PublicEndpoint()`). 그래야 API 의 열린 표면이
grep 되는 목록이 된다.

### 인증이 없는 동안의 요청 사용자

```ts
interface RequestPrincipal extends AuthorizationSubject {
  userId: string
  roles: Role[]
  sellerId: string | null   // own 스코프가 해석하는 스토어
  app: AppId | null
}

interface PrincipalResolver {
  resolve(request): Promise<RequestPrincipal | null>   // null = 익명
}
```

가드·스코프 검사는 **이 계약만** 본다. 지금 바인딩된 구현은 `AnonymousPrincipalResolver`(항상 `null`)이고,
TASK-0022 가 JWT 해석 구현으로 **프로바이더 한 줄을 교체**한다. 다른 파일은 움직이지 않는다.

주체는 요청 객체에 **모듈 전용 심볼**로 붙는다. 문자열 키였다면 헤더나 본문에서 흘러들어온 값이 주체를
사칭할 수 있다.

### 두 단계 검사

가드는 "이 역할이 이 동작을 하기는 하나"까지만 답한다. "이 **행**에 해도 되나"는 행을 읽은 뒤에야 답할 수
있으므로 서비스가 `assertResourceAccess(principal, permission, ownership)` 를 한 번 부른다.
스코프 판정은 이 함수 하나뿐이고(R2), 서비스는 규칙을 모른다.

## 5. 구현 계획

1. 퍼미션 상수·역할 매핑 정의 (`packages/shared`)
2. `@RequirePermission()` · `@PublicEndpoint()` · 전역 가드 (기본 거부)
3. 리소스 스코프 검사 (own / demo / any) + 소유 정보 매퍼
4. 역할 부여·회수 API
5. 권한 매트릭스 문서 생성 스크립트 + 어긋남 감지 테스트
6. 전 엔드포인트 퍼미션 선언 검사 (정적)

TASK-0020 의 `UserRole` 은 조정하지 않았다 — `Role` 열거형 5종이 이미 이 설계와 일치하므로
`schema.prisma` 변경이 필요 없었다. `packages/shared` 의 역할 목록이 Prisma 열거형과 어긋나면
`role-parity.spec.ts` 가 타입 검사와 테스트 양쪽에서 깨진다.

## 6. 완료 기준

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 결과 | 충족 |
| --- | --- | --- | --- | --- | --- |
| F1 | 퍼미션 차단 | `BUYER` 로 `POST` (`product.write`) 호출 | 403 | 403 · `details: ["product.write 퍼미션이 없습니다."]` | [x] |
| F2 | own 스코프 | 판매자 A 가 판매자 B 상품 수정 | 403 | 403 · `out_of_scope` 문구. 자기 스토어는 201 | [x] |
| F3 | demo 스코프 — 차단 | 데모 관리자가 시드 카테고리 수정·삭제 시도 | 403 | 수정 403(스코프 밖) · 삭제는 `catalog.delete` 자체가 없어 403 | [x] |
| F4 | demo 스코프 — 허용 | 데모 관리자가 `seller.approve` 를 **데모 소유 리소스**에 호출 | 성공 | 201. 같은 호출을 실계정 리소스에 하면 403 | [x] |
| F5 | 데모 상호작용 | 판매자 데모 신청 → 관리자 데모 승인 전 과정 | 전 과정 성공 | 입점 신청 플로가 아직 없음 → **TASK-0026 에서 검증** | [ ] |
| F6 | 프론트 표시 | — | — | **TASK-0023 으로 이관** (2장) | [ ] |
| F7 | 누락 방지 | 전 엔드포인트 정적 검사 + 실제 호출 | 퍼미션 미지정 0건 | 미지정 0건. 데코레이터를 떼고 호출하면 403 + 에러 로그 | [x] |
| F8 | isDemo 분기 없음 | 비즈니스 로직 `grep -i isdemo` | 권한 계층 밖 0건 | 0건 (`schema.prisma` 컬럼 정의 제외) | [x] |
| F9 | 인증 없는 호출 | 자격 증명 없이 보호 엔드포인트 호출 | 401 | 401 · `UNAUTHORIZED` | [x] |
| F10 | 403 응답 포맷 | 모든 거부 응답을 `apiErrorSchema` 로 검증 | 공통 envelope | 전부 통과 | [x] |

F1~F4·F9·F10 은 **실제 HTTP 왕복**으로 검증했다(`authorization.integration.spec.ts` — Nest 앱을
띄우고 `fetch` 로 호출, 응답 본문을 `apiErrorSchema` 로 검사). 인증이 없으므로 주체는 테스트 헤더를 읽는
`PrincipalResolver` 구현이 채운다 — TASK-0022 의 JWT 구현이 들어갈 바로 그 자리다.

F4 는 도메인 엔드포인트가 아직 없어(입점 승인은 TASK-0026, 카탈로그는 M06) **`seller.approve` ·
`product.write` · `catalog.write` 를 선언한 픽스처 컨트롤러**로 확인했다. 가드·스코프 검사·예외 필터·
응답 포맷은 전부 실제 구현이고, 픽스처인 것은 "행을 읽어 오는" 부분뿐이다.

F7 의 실제 호출 검증은 `@PublicEndpoint()` 를 일시적으로 떼고 빌드해 확인했다:

```
GET /api/v1/health  →  403
{"error":{"code":"FORBIDDEN","message":"이 작업을 수행할 권한이 없습니다.",
          "details":["엔드포인트에 퍼미션이 선언되지 않았습니다."]}}
[PermissionGuard] HealthController.check 에 퍼미션 선언이 없어 요청을 차단했습니다. (기본 거부)
```

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:
- **Q5 강화** — 퍼미션·스코프 판정 로직은 **분기 커버리지 100%**. 권한은 틀리면 데이터가 새거나 잠긴다
- **2장 화면 게이트 해당 없음** — 화면은 TASK-0023 으로 이관
- **3장**: A2·A3·A4 적용, A1·A5 는 조회 대상 테이블이 없어 해당 없음
- **4장 해당 없음** — `schema.prisma` 무변경

| # | 기준 | 결과 | 충족 |
| --- | --- | --- | --- |
| Q1 | `pnpm typecheck` | error 0 | [x] |
| Q2 | `pnpm lint` | error 0 · warning 0 (`format:check` 포함) | [x] |
| Q3 | `pnpm build` | 전 패키지 성공 | [x] |
| Q4 | `pnpm test` | 167 통과 (0105 이전 75 + 신규 92) | [x] |
| Q5 | 판정 로직 분기 | `authorize.spec.ts` 가 스코프 3종 × 역할 5종 × 리소스 6종을 표로 고정. `own` 의 `null` 분기까지 포함 | [x] |
| Q6 | CI | PR 의 GitHub Actions 4개 | [x] |
| Q7 | commitlint | 위반 0 | [x] |
| A2 | 입력 검증 | 잘못된 UUID·역할 → 400 + 공통 포맷 | [x] |
| A3 | 권한 | 권한 없는 역할로 호출 → 403 | [x] |
| A4 | 인증 | 자격 증명 없이 호출 → 401 | [x] |

커버리지 게이트(80%)는 M05 부터라 수치는 재지 않았다. Q5 는 수치가 아니라 **분기 목록**으로 관리했다 —
스코프 3종, 거부 사유 2종, 다중 역할 합집합, 소유자 `null`, 데코레이터 4가지 조합(퍼미션만 / 공개만 /
둘 다 / 둘 다 없음)이 각각 테스트를 가진다.

### 6.3 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | [x] |
| D2 | 역할 × 퍼미션 매트릭스를 `docs/design/erd.md` 1장에 반영 | [x] |
| D3 | 역할 × 퍼미션 매트릭스가 `DECISIONS.md` 와 일치하는지 확인 | [x] |

- D1 의 인덱스 2곳(`docs/tasks/README.md`, `docs/tasks/M04-auth/README.md`)은 이 브랜치의 파일 소유권
  밖이라 **오케스트레이터가 갱신**한다. 이 문서의 상태·본문 갱신은 여기서 끝냈다.
- D2 는 `erd.md` 1장에 생성 문서(`docs/design/permission-matrix.md`)를 가리키는 링크를 넣어 맞췄다.
  표를 두 곳에 적지 않는다 — 한쪽은 반드시 낡는다.
- D3 확인 결과 `DECISIONS.md` 2장(역할 5종 · 퍼미션 기반 RBAC · 스코프 3종 · 기본 거부 ·
  `DEMO_ADMIN` = `ADMIN_OPERATOR` + `demo`)과 구현이 일치한다. 결정 변경 없음.
- D4 해당 없음 — 새 환경변수 없음. D5 해당 없음 — 새 라이브러리 없음(8장).

## 7. 권한 매트릭스 문서 생성

```
packages/shared/src/auth/role-permissions.ts   ← 단일 출처
        │
        │  renderPermissionMatrix()
        ▼
docs/design/permission-matrix.md               ← 생성물. 손으로 고치지 않는다
```

- 생성: `pnpm --filter @shopping/api docs:matrix`
- 어긋남 감지: `apps/api/src/auth/permission-matrix.spec.ts` 가 생성 결과와 커밋된 파일을
  **바이트 단위로 비교**한다. 그랜트를 바꾸고 문서를 다시 만들지 않으면 CI 의 test job 이 실패한다.

문서를 손으로 쓰지 않는 이유는 게으름이 아니다. **낡은 권한표는 없는 것보다 나쁘다** — 사람들이 그것을
읽고 역할이 안전하다고 판단한다.

## 8. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | 퍼미션 부여를 빠뜨린 엔드포인트가 무방비로 열림 | **기본 거부**로 설계했다. 선언 없는 핸들러는 접근 불가. F7 로 검증하고 `endpoint-coverage.spec.ts` 가 CI 에서 막는다 |
| R2 | 스코프 검사가 각 서비스에 흩어짐 | 스코프 판정은 `assertResourceAccess` 하나다. 서비스는 소유 정보 매퍼를 부르고 결과를 넘기기만 한다 |
| R3 | 역할이 늘어 관리가 복잡 | 5개로 시작한다. 매트릭스 문서를 자동 생성해 한눈에 본다 |
| R4 | 퍼미션 목록에 `claim.write`(구매자의 반품 신청)·`seller.write`(판매자의 스토어 정보 편집)가 없다 | 해당 엔드포인트가 아직 없어 **지금은 구멍이 아니다**. 만드는 TASK(M08 · TASK-0026)가 퍼미션을 추가하고 매트릭스를 다시 생성한다. 목록을 미리 늘리면 아무도 쓰지 않는 권한이 표에 남는다 |
| R5 | `DEMO_ADMIN` 이 실계정을 **조회**할 수 있다 (읽기는 `any`) | `erd.md` 1장의 결정("시드·실계정 데이터는 조회만")을 그대로 따랐다. 개인정보 노출은 권한이 아니라 **응답 필드 마스킹**으로 다룰 문제이며, 실제 사용자 목록 화면을 만드는 TASK 에서 처리한다 |
| R6 | 인증 미구현 상태의 403 검증이 테스트 전용 주체에 의존 | 주체 계약(`PrincipalResolver`)이 프로덕션 코드이고 테스트는 그 구현 하나만 바꾼다. TASK-0022 가 JWT 구현을 넣으면 같은 테스트가 그대로 유효하다 |

## 9. 확정된 버전

새로 추가한 의존성은 없다. 이 TASK 를 검증한 조합은 다음과 같다.

| 항목 | 버전 |
| --- | --- |
| Node | 24.13.1 |
| pnpm | 9.15.9 |
| TypeScript | 6.0.3 |
| NestJS | 12.0.1 |
| Prisma | 7.10.0 |
| zod | 4.5.4 |
| Vitest | 4.1.11 |

## 10. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-03 | 완료. 퍼미션 23개·역할 5종을 `packages/shared` 에 코드 상수로 정의하고, 전역 `PermissionGuard`(기본 거부) · 리소스 스코프 검사(`own`/`demo`/`any`) · 역할 부여·회수 API · 매트릭스 자동 생성을 구현. `DEMO_ADMIN` 은 `ADMIN_OPERATOR` 에서 파생한다. 프론트 권한 훅은 TASK-0023 으로 이관(F6), 데모 상호작용 전 과정(F5)은 입점 플로가 있는 TASK-0026 에서 검증. `schema.prisma` 무변경 |
