# TASK-0111: 프로필 · 배송지 · 사용자 설정 API

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M04 인증·계정 |
| 상태 | 승인됨 |
| 작성일 | 2026-09-03 |
| 브랜치 | `feature/profile-address-api` |
| 선행 작업 | TASK-0022, TASK-0105, TASK-0106 |

> **분할 유래** — TASK-0027(프로필 · 배송지 관리)의 백엔드 절반이다. D-208 에 따라 화면과 API 를 나눴고,
> 화면은 TASK-0112 가 맡는다. 원본에 섞여 있던 **판매자 스토어 설정**은 판매자 도메인으로 옮겨
> TASK-0108(API) · TASK-0109(화면)이 담당한다.

## 1. 목적

내 계정을 다루는 API 를 만든다 — 프로필 조회·수정, 배송지 CRUD 와 기본 배송지 지정, 표시·알림 설정,
회원 탈퇴. 배송지는 주문서(M07)가 그대로 읽어 간다.

**기본 배송지가 항상 정확히 1개**라는 불변식을 애플리케이션이 아니라 **DB 가 강제하는지**를 이 TASK 가
처음으로 실제 검증한다(D-207 의 계기가 된 구멍).

**선행이 TASK-0023 이 아닌 이유**: 원본 TASK-0027 의 선행은 TASK-0023(인증 UI)이었으나, API 에 필요한
것은 요청 주체를 채우는 JWT(TASK-0022)와 퍼미션 가드(TASK-0105)다 (D-204).

## 2. 범위

### 포함
- **프로필 조회 · 수정 API** — 이름, 아바타 URL
- **사용자 설정 API** — 표시 밀도(3단계), 알림 수신 여부(주문 · 클레임 · 마케팅), locale · currency
- **밀도 서버 승격** — 비로그인 localStorage 값을 로그인 시 서버로 올린다. **별도 엔드포인트가 아니다** — `PATCH /me/preferences` 그대로다 (4장 「밀도 승격」)
- **배송지 CRUD API** — 목록 · 생성 · 수정 · 삭제
- **기본 배송지 지정 API** — 한 트랜잭션에서 기존 기본 해제 후 지정
- **회원 탈퇴 API** — `User.deletedAt` 소프트 삭제 + **배송지 하드 삭제**
- **퍼미션 `profile.write` · `profile.delete` 추가** + 권한 매트릭스 재생성 (TASK-0105 4장 예고)
- 절단면이 되는 zod 스키마를 `packages/shared` 에 정의

### 제외 (이번에 하지 않는 것)
- **프로필 · 배송지 화면** → TASK-0112
- **우편번호 검색** — 외부 위젯을 쓰는 프론트 기능이다 → TASK-0112. 서버는 정규화하지 않고 받은 값을 저장한다
- **판매자 스토어 설정** → TASK-0108 로 이관
- 주문서에서의 배송지 선택 (M07 · TASK-0050)
- 알림 실제 발송 (M13 · TASK-0090). 이 TASK 는 수신 **여부 값**만 저장한다
- 탈퇴 계정의 개인정보 파기 스케줄 (TASK-0025)
- `schema.prisma` 변경 — `Address` · `UserPreference` 는 TASK-0020 이 이미 만들었다

## 3. 요구사항

### 기능 요구사항
- [ ] 프로필을 수정하면 다시 조회했을 때 반영되어 있다
- [ ] 배송지를 여러 개 저장하고 그중 하나를 기본으로 지정할 수 있다
- [ ] 기본 배송지는 **항상 1개**이며, 동시 요청에서도 2개가 되지 않는다
- [ ] 밀도 설정이 서버에 저장되어 다른 기기에서 같은 값이 나온다
- [ ] 탈퇴 후에는 로그인할 수 없고, 과거 주문 이력은 남는다
- [ ] 탈퇴 시 배송지 행이 실제로 삭제된다
- [ ] 남의 배송지를 조회·수정·삭제할 수 없다 (403)

### 비기능 요구사항
- 기본 배송지 전환은 트랜잭션 하나로 처리한다
- 배송지 목록은 개인 데이터이므로 **항상 `own` 스코프**로 판정한다 (요청의 `userId` 를 신뢰하지 않는다)

## 4. 설계

### API / 라우트

| 메서드 · 경로 | 용도 | 퍼미션 | 성공 | 응답 스키마 |
| --- | --- | --- | --- | --- |
| `GET /api/v1/me` | 프로필 + 설정 조회 | `user.read:own` | 200 | `profileResponseSchema` |
| `PATCH /api/v1/me` | 프로필 수정 (이름 · 아바타) | `profile.write:own` | 200 | `profileResponseSchema` |
| `GET /api/v1/me/preferences` | 표시·알림 설정 조회 | `user.read:own` | 200 | `userPreferenceResponseSchema` |
| `PATCH /api/v1/me/preferences` | 설정 수정 (밀도 승격 포함) | `profile.write:own` | 200 | `userPreferenceResponseSchema` |
| `GET /api/v1/me/addresses` | 배송지 목록 | `user.read:own` | 200 | `addressListResponseSchema` |
| `POST /api/v1/me/addresses` | 배송지 추가 | `profile.write:own` | 201 | `addressResponseSchema` |
| `PATCH /api/v1/me/addresses/:id` | 배송지 수정 | `profile.write:own` | 200 | `addressResponseSchema` |
| `DELETE /api/v1/me/addresses/:id` | 배송지 삭제 | `profile.write:own` | 200 | `addressResponseSchema` |
| `POST /api/v1/me/addresses/:id/default` | 기본 배송지 지정 | `profile.write:own` | 200 | `addressResponseSchema` |
| `DELETE /api/v1/me` | 회원 탈퇴 | `profile.delete:own` | 200 | `withdrawalResponseSchema` |

`/me` 로 묶는 이유: 경로에 `userId` 가 없으면 **다른 사람 것을 요청할 방법 자체가 없다.** 스코프 검사는
그 위의 두 번째 방어선이다.

**삭제도 본문을 돌려준다.** 204 가 아니라 200 인 것은 화면이 "무엇이 지워졌는지" 를 다시 묻지 않아도 되게
하기 위해서이고(지운 배송지 1건, 탈퇴 시 지운 배송지 수·끊은 세션 수), 응답을 zod 로 파싱하는 계약 게이트
C3 가 **본문 없는 응답에는 걸리지 않기** 때문이다. 카탈로그의 `DELETE /products/:id` 가 이미 같은 모양이다.

**실패 계약**

| 상황 | 상태 | 비고 |
| --- | --- | --- |
| 토큰 없음 | 401 `AUTH_REQUIRED` | A4 |
| 퍼미션 없음 (`ADMIN_OPERATOR` 의 `PATCH /me`) | 403 | A3 |
| 남의 배송지 id | 403 | F6. `ADMIN_SUPER` 도 마찬가지 |
| 없는 배송지 id · 탈퇴한 계정 | 404 | 탈퇴 후 재호출도 404 |
| 우편번호 5자리 아님 · 알 수 없는 밀도 | 400 + `details[].field` | A2 |
| 기본 배송지 동시 지정에서 진 쪽 | 409 | F3b |

### 퍼미션 추가 — `profile.write` · `profile.delete`

TASK-0105 는 `user.write` 를 `ADMIN_SUPER` 전용으로 두면서 이렇게 적었다 — "자기 프로필 편집은 다른
능력이며 그 화면을 만드는 TASK 에서 별도 퍼미션을 받는다." 그 퍼미션이 이것이다.

| 퍼미션 | 그랜트 | 이유 |
| --- | --- | --- |
| `profile.write` | `BUYER:own`, `SELLER_OWNER:own` | 자기 계정의 프로필·설정·배송지 편집 |
| `profile.delete` | `BUYER:own`, `SELLER_OWNER:own` | **탈퇴는 되돌릴 수 없다.** "표시 밀도 변경"과 같은 퍼미션을 쓰면, 밀도 변경만 허용하려는 미래의 어떤 역할도 탈퇴 권한을 함께 갖는다 |

`ADMIN_*` 에는 주지 않는다. 관리자가 남의 계정을 다루는 능력은 `user.write` · `user.delete` 가 이미
담당하고 있으며, 그쪽은 `ADMIN_SUPER` 전용이다. `ADMIN_SUPER` 는 전체 목록을 갖는 규칙 때문에
`profile.*:any` 를 자동으로 얻지만, `/me` 경로는 언제나 **자기 자신**을 가리키므로 남의 계정에 닿지 않는다.

퍼미션을 늘렸으므로 `docs/design/permission-matrix.md` 를 다시 생성한다.

### 기본 배송지 — DB 가 강제한다

```
Address_userId_default_key   partial unique index  WHERE "isDefault"
```

`erd.md` 1장이 이유를 적어 뒀다 — 서비스에서 "이미 기본이 있는가"를 확인하면 **동시에 들어온 두 요청이
둘 다 0개를 읽고 둘 다 1개를 쓴다.** 기본 지정은 한 트랜잭션에서 해제 후 지정한다.

이 인덱스는 TASK-0020 이 마이그레이션에 손으로 쓴 SQL 로 넣었고, 지금까지 **파일에 그 문자열이 있는지만**
검사했다(D-207). 이 TASK 가 그것을 실제 위반으로 검증한다(S5, F3b).

**"항상 정확히 1개" 가 성립하려면 세 순간을 전부 정해야 한다.** 인덱스는 "둘이 될 수 없다" 만 말하고
"하나는 있어야 한다" 는 말하지 않는다. 그래서 서비스가 다음 세 규칙을 갖고, 규칙 자체는 순수 함수
(`src/profile/default-address.ts`)에 두어 분기 100% 로 고정한다(Q5 강화).

| 순간 | 규칙 | 이유 |
| --- | --- | --- |
| 생성 | **첫 배송지는 요청과 무관하게 기본이 된다.** `isDefault: true` 로 만들면 기존 기본을 같은 트랜잭션에서 해제한다 | 배송지가 있는데 기본이 없는 상태를 만들지 않는다. 주문서(M07)가 "기본 배송지" 를 항상 찾을 수 있어야 한다 |
| 지정 | 한 트랜잭션에서 **해제 후 지정.** 이미 기본인 배송지를 다시 지정하면 아무것도 쓰지 않고 현재 값을 돌려준다 | 멱등. 더블클릭이 인덱스 위반으로 보이면 안 된다 |
| 삭제 | 기본을 지우면 **남은 것 중 가장 최근에 만든 것**(`createdAt` 내림차순, 동률이면 `id` 내림차순)이 자동 승격한다. 남은 것이 없으면 기본도 없다 | "다음 배송지" 가 무엇인지 정해두지 않으면 구현마다 달라진다. id 는 UUIDv7 이라 생성 순서를 그대로 담으므로 동률 판정까지 결정적이다 |

**충돌은 409 다.** 서로 다른 두 배송지를 동시에 기본으로 지정하면 진 쪽은 `Address_userId_default_key`
위반(`23505`)을 받는다. 이것을 재시도로 감추지 않고 **409 Conflict** 로 돌려준다 — 사용자가 두 화면에서
서로 다른 기본을 고른 것이므로 이긴 값을 조용히 덮어쓰는 편이 더 나쁘다. F3b 가 이 계약을 고정한다.

### 밀도 승격

```
비로그인   localStorage 에 밀도 저장
로그인     ① 클라이언트가 localStorage 값을 PATCH /me/preferences 로 올린다 (승격)
           ② 이후 서버 값이 단일 출처. localStorage 는 캐시로만 남는다
```

서버는 "승격인지 일반 변경인지"를 구분하지 않는다. 같은 엔드포인트를 쓰고, **누가 먼저 저장했는지에
따라 값이 정해진다.** 구분하려면 클라이언트가 보낸 플래그를 믿어야 하는데 그럴 이유가 없다. 승격 시점
판단은 TASK-0112 의 몫이다.

### 탈퇴

| 대상 | 처리 | 이유 |
| --- | --- | --- |
| `User` | `deletedAt` 소프트 삭제 | 주문·리뷰·정산이 참조한다 (`erd.md` 1장) |
| `Address` | **하드 삭제** | 주문이 수령인을 스냅샷으로 갖는다. 개인정보를 실제로 지울 수 있어야 한다 |
| `RefreshToken` | 전부 revoke | 탈퇴 즉시 세션이 끊겨야 한다 |
| `UserPreference` | 그대로 둔다 | 표시 밀도·알림 스위치는 개인 식별 정보가 아니다. 계정 행이 남는 한 이 행도 `Cascade` 로 지워지지 않으며, 지울 이유도 없다 |
| `googleSub` | 그대로 둔다 | 부분 유니크 인덱스(`WHERE "deletedAt" IS NULL`)가 재가입을 이미 허용한다. 값 삭제는 TASK-0025 의 파기 절차 |

**"탈퇴 후에는 로그인할 수 없다" 가 뜻하는 것.** 탈퇴한 *계정* 에 다시 들어갈 수 없다는 뜻이지, 그 사람이
다시 가입할 수 없다는 뜻이 아니다. `GoogleAuthService.findByGoogleSub` 가 `deletedAt IS NULL` 로 찾으므로
같은 Google 계정으로 다시 로그인하면 **새 계정이 만들어진다**(`user id` 가 다르다). 옛 계정의 이력은 옛
행에 그대로 남는다. F5 는 이 두 가지를 함께 확인한다.

### 데이터 모델 변경

**없다.** `User`(name · avatarUrl · deletedAt) · `Address` · `UserPreference` 모두 TASK-0020 이 만들었다.
따라서 **4장 데이터 게이트는 해당 없음**이며, **S5 만 자발적으로 적용**한다.

### 절단면 — `packages/shared` 의 zod 스키마

이 TASK 가 **정의**하고 그대로 응답한다. TASK-0112 가 **같은 스키마로 모킹 데이터를 만든다.**

| 스키마 | 내용 | 쓰는 곳 |
| --- | --- | --- |
| `profileSchema` | 프로필 1건 (id, email, name, avatarUrl, isDemo, roles) | 0111 · 0112 |
| `profileResponseSchema` | **`{ profile, preference }`** — `GET · PATCH /me` 의 응답 | 0111 · 0112 |
| `profileUpdateRequestSchema` | 이름 · 아바타 수정 본문 | 0111 · 0112 |
| `addressSchema` | 배송지 1건 (id, label, recipientName, phone, postalCode, addressLine1/2, isDefault) | 0111 · 0112 · (M07 주문서) |
| `addressCreateRequestSchema` | 배송지 생성 본문 (`isDefault` 포함) | 0111 · 0112 |
| `addressUpdateRequestSchema` | 배송지 수정 본문 (부분 갱신) | 0111 · 0112 |
| `addressResponseSchema` | `{ address }` — 배송지 1건을 답하는 네 엔드포인트의 응답 | 0111 · 0112 |
| `addressListResponseSchema` | `{ items: addressSchema[] }` | 0111 · 0112 |
| `userPreferenceSchema` | density, locale, currency, notifyOrder, notifyClaim, notifyMarketing | 0111 · 0112 |
| `userPreferenceResponseSchema` | `{ preference }` — `GET · PATCH /me/preferences` 의 응답 | 0111 · 0112 |
| `userPreferenceUpdateRequestSchema` | 설정 수정 본문 (부분 갱신) | 0111 · 0112 |
| `withdrawalResponseSchema` | `DELETE /me` 의 응답 (userId, deletedAt, deletedAddresses, revokedSessions) | 0111 · 0112 |
| `DEFAULT_USER_PREFERENCE` | 설정 행이 없는 계정이 받는 기본값 | 0111 · 0112 |

**`GET /me` 가 프로필과 설정을 함께 답하므로 응답 스키마는 둘을 감싼다.** 처음 표에는
`profileResponseSchema` 가 프로필 필드 그 자체로 적혀 있었는데, 그러면 4장 라우트 표의 "프로필 + 설정
조회" 와 어긋난다. 감싸는 쪽을 택한 이유는 화면이 마이페이지를 그릴 때 두 번 부르지 않아도 되고,
`profileSchema` 라는 이름이 프로필 **한 건** 을 가리키게 되어 M07 이 재사용하기 쉽기 때문이다.

**설정 행은 지연 생성한다.** `UserPreference` 는 로그인 시점에 만들어지지 않으므로(TASK-0021 은 만들지
않는다) 조회는 행이 없을 때 `DEFAULT_USER_PREFERENCE` 를 답하고, 수정은 `upsert` 한다. **조회가 쓰지
않는다** — `GET` 이 행을 만들면 읽기 전용 복제나 권한 축소에서 바로 깨진다. 기본값은 `schema.prisma` 의
컬럼 기본값과 같아야 하며, 그 일치는 실제 DB 로 확인한다(F4b).

`addressSchema` 는 **M07 주문서(TASK-0050)가 그대로 재사용할 절단면**이기도 하다. 우편번호는 한국식
5자리 문자열로 스키마에 못 박고, 전화번호 형식도 여기에만 적는다.

**목록 순서도 계약이다.** `GET /me/addresses` 는 **기본 배송지 먼저, 그다음 최근 생성 순**
(`isDefault` 내림차순 → `createdAt` 내림차순 → `id` 내림차순)으로 답한다. 정렬을 정하지 않으면 화면이
매번 다른 순서를 받고, "기본 배송지가 맨 위" 라는 UI 규칙이 화면마다 다시 구현된다.

### 역할별 권한

전 역할이 자기 계정에 대해서만 동작한다. 판매자·관리자도 사람이므로 같은 엔드포인트를 쓴다.

| 역할 | `GET /me` (`user.read`) | `PATCH /me` · 배송지 (`profile.write`) | `DELETE /me` (`profile.delete`) |
| --- | --- | --- | --- |
| `BUYER` · `SELLER_OWNER` | ✅ `own` | ✅ `own` | ✅ `own` |
| `ADMIN_OPERATOR` | ✅ `any` | ❌ **403** | ❌ **403** |
| `DEMO_ADMIN` | ✅ `any` | ❌ **403** | ❌ **403** |
| `ADMIN_SUPER` | ✅ `any` | ✅ `any` | ✅ `any` |

**`ADMIN_OPERATOR` · `DEMO_ADMIN` 은 자기 프로필도 고치지 못한다.** 위 퍼미션 표가 `profile.*` 를
`BUYER` · `SELLER_OWNER` 에만 주고 `ADMIN_*` 에는 주지 않기 때문이고, `ADMIN_SUPER` 만 "전체 목록" 규칙으로
자동으로 받는다. 최초 작성본은 "`DEMO_ADMIN` 도 자기 데모 계정의 프로필을 고칠 수 있다" 고 적었는데
**퍼미션 테이블과 어긋난다.** 계정이 `BUYER` 를 함께 갖고 있으면 그쪽 그랜트로 통과하지만
(`GoogleAuthService` 는 신규 계정에 `BUYER` 를 준다), `DEMO_ADMIN` 단독 계정은 403 이다. 데모 계정에 어떤
역할을 함께 줄지는 TASK-0024 가 정하고, 퍼미션 자체를 바꾸려면
`packages/shared/src/auth/role-permissions.ts` 를 고쳐야 하므로 **둘 다 이 TASK 의 범위가 아니다.**

`ADMIN_SUPER` 가 `profile.write:any` 를 갖는 것이 남의 계정에 닿는 길이 되지 않도록, `/me` 계열은 스코프
검사에 더해 **대상 행이 호출자 자신의 것인지**를 한 번 더 본다(R4). 남의 배송지 id 를 `/me/addresses/:id`
에 넣으면 `ADMIN_SUPER` 도 403 이다.

## 5. 구현 계획

1. `packages/shared` 에 절단면 스키마 정의 + `index.ts` export
2. ~~`profile.write` · `profile.delete` 퍼미션 추가, 그랜트 반영, 매트릭스 재생성~~ — **커밋 `89b1e50` 에서
   이미 끝났다.** 웨이브의 세 TASK(0108 · 0111 · 0117)가 같은 파일을 건드리는 것을 피하려고 퍼미션만 먼저
   `main` 에 넣었다. 이 TASK 는 **그 퍼미션을 쓰기만 한다** (F9 는 그래서 회귀 확인이다)
3. 기본 배송지 규칙을 순수 함수로 분리 (`src/profile/default-address.ts`, 분기 100%)
4. 프로필 조회·수정 API
5. 사용자 설정 API (밀도 · 알림 · locale · currency) — 행 지연 생성
6. 배송지 CRUD API (`own` 스코프 검사 + `/me` 자기 자신 확인)
7. 기본 배송지 전환 (트랜잭션 · 부분 유니크 인덱스 의존 · 충돌 409)
8. 탈퇴 처리 (소프트 삭제 + 배송지 하드 삭제 + 토큰 revoke)
9. 실제 PostgreSQL 통합 테스트 — 동시 기본 지정(음성 대조군 포함), 위반 INSERT 거부, 탈퇴 후 조회

## 6. 완료 기준 (Definition of Done)

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 프로필 수정 | `PATCH /me` 로 이름 변경 후 `GET /me` | 변경값 반환 | [ ] |
| F2 | 배송지 추가 | 3건 생성 후 목록 조회 | 3건 반환, 각 항목이 `addressSchema` 통과 | [ ] |
| F3 | 기본 배송지 전환 | 다른 배송지를 기본으로 지정 | 이전 기본 해제, `isDefault=true` 가 정확히 1건 | [ ] |
| F3b | 기본 배송지 동시 지정 | 서로 다른 두 배송지에 기본 지정을 동시 호출 | 한 건 성공·한 건 실패, `isDefault=true` 1건 유지 (A7) | [ ] |
| F3c | DB 강제 확인 | `isDefault=true` 인 두 번째 행을 psql 로 직접 INSERT | **DB 가** 거부 (S5) | [ ] |
| F3d | 기본 배송지 삭제 | 기본 배송지를 삭제 | 남은 것 중 가장 최근 생성분이 자동 승격, `isDefault=true` 1건 (R3) | [ ] |
| F4 | 밀도 승격 | `PATCH /me/preferences` 로 `MAXIMAL` 저장 후 다른 세션에서 조회 | 같은 값 반환 | [ ] |
| F4b | 설정 기본값 일치 | 설정 행이 없는 계정의 `GET /me/preferences` 와, 빈 행을 SQL 로 넣은 계정의 조회를 비교 | 두 응답이 같고 `DEFAULT_USER_PREFERENCE` 와 일치 | [ ] |
| F5 | 탈퇴 | `DELETE /me` 실행 | `Address` 행 0건, `User` 행은 남고 `deletedAt` 이 찍힌다, 그 계정을 참조하는 이력 행(`StockLedger.actorId`)이 남는다, 같은 `googleSub` 로 다시 로그인하면 **다른 user id** 가 나온다 | [ ] |
| F6 | 남의 배송지 | 다른 사용자의 배송지 id 로 `PATCH` | 403 (`own` 스코프). `profile.write:any` 를 가진 `ADMIN_SUPER` 도 403 | [ ] |
| F7 | 알림 설정 | 마케팅 수신 끄기 | 재조회 시 `notifyMarketing=false` | [ ] |
| F8 | 탈퇴 후 세션 | 탈퇴 직후 기존 refresh 토큰으로 갱신 시도 | 401 | [ ] |
| F9 | 매트릭스 재생성 | `pnpm --filter @shopping/api docs:matrix` 후 `git diff` | 차이 0줄 — `89b1e50` 이 이미 반영했다. `permission-matrix.spec.ts` 통과 | [ ] |
| F10 | `/me` 에는 남의 것을 요청할 방법이 없다 | 라우트 목록에서 사용자 식별자를 받는 경로를 센다 | 0건 — `:id` 는 전부 **자기 배송지** 를 가리킨다 | [ ] |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 이 TASK 는 **엔드포인트를 추가하는 백엔드 TASK** 이므로
1장 · 3장 · 5장(C1·C3) · 7장을 받는다.

| 장 | 적용 | 비고 |
| --- | --- | --- |
| 1장 코드 게이트 | Q1~Q4 · Q6 · Q7 전부 | |
| Q5 테스트 충실도 | **커버리지 수치는 면제**(M05 부터). 기본 배송지 전환 규칙은 순수 로직이므로 **분기 100%**(Q5 강화) | 대역: **실제 PostgreSQL** |
| **2장 화면 게이트** | **해당 없음** | 사용자 대상 화면이 없다. 화면은 TASK-0112 |
| 3장 API 게이트 | A1~A7 전부 | A7 = F3b 동시 기본 지정 |
| 4장 데이터 게이트 | **해당 없음** (`schema.prisma` 무변경). 단 **S5 적용** | `Address_userId_default_key` 가 실제로 거부하는지 확인(F3c) |
| 5장 계약 게이트 | **C1 · C3** | C2 는 TASK-0112 |
| 7장 문서 게이트 | D1~D5 | |

> **A5 의 원문 정정.** "프로필+설정+배송지 동시 조회" 라고 적혀 있었으나 4장 라우트 표에서 `GET /me` 는
> 배송지를 싣지 않는다(절단면 표에도 없다). 배송지 건수에 비례할 수 있는 것은 `GET /me/addresses` 뿐이므로
> 그쪽을 측정 대상으로 바꿨다.

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| A1 | 응답 시간 | 배송지 목록 p95 | 300ms 이하 | [ ] |
| A2 | 입력 검증 | 우편번호 4자리 · 알 수 없는 밀도값 | 400 + 통일된 에러 포맷 | [ ] |
| A3 | 권한 | 퍼미션 없는 주체로 `PATCH /me` 호출 | 403 | [ ] |
| A4 | 인증 | 토큰 없이 호출 | 401 | [ ] |
| A5 | N+1 | 배송지 1건과 50건의 `GET /me/addresses` 쿼리 로그 비교 + `GET /me` 쿼리 수 | 배송지 건수와 무관하게 쿼리 수 일정 | [ ] |
| A6 | 실 DB | 서비스·API 테스트 실행 대상 | Prisma 모킹 0건, 실제 PostgreSQL | [ ] |
| A7 | 동시 요청 | F3b | 기본 배송지 2개 발생 0건 | [ ] |
| S5 | 제약 강제 | F3c | **DB 가** 거부 | [ ] |
| C1 | 스키마 단일 출처 | 응답 DTO 출처 확인 | 전부 `packages/shared` 의 zod 스키마 | [ ] |
| C3 | 실제 응답 검증 | 통합 테스트가 `createApiClient` 를 통해 호출하므로 모든 응답이 해당 zod 스키마로 `parse` 된다 | 전부 통과 | [ ] |

### 6.3 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태를 `완료` 로 변경 + `docs/tasks/README.md` · `M04-auth/README.md` 인덱스 갱신 | [ ] |
| D2 | 밀도 저장 정책(비로그인 localStorage → 로그인 서버 승격)을 `docs/design/pages.md` 에 반영 | [ ] |
| D3 | 결정 변경 없음 확인 (`DECISIONS.md` 2장과 대조) | [ ] |
| D4 | 새 환경변수 없음 확인 | [ ] |
| D5 | 새 라이브러리 없음 확인 (8장) | [ ] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | **프로필의 "연락처"를 저장할 컬럼이 없다.** 원본 TASK-0027 은 프로필에 연락처를 넣었지만 `User` 에 전화번호 컬럼이 없다 | **①로 확정.** 연락처는 배송지(`Address.phone`)에만 둔다. 2장이 `schema.prisma` 무변경을 못 박았고 4장 절단면의 `profileUpdateRequestSchema` 도 이름·아바타만 받으므로, 이 TASK 안에서는 ①만 실행 가능하다. `User.phone` 이 필요해지면 스키마를 건드리는 **별도 TASK** 다(병행 규칙 1) |
| R2 | 탈퇴한 사용자의 개인정보가 배송지에 남는다 | 탈퇴 시 배송지는 **하드 삭제**한다. 주문의 수령인 스냅샷만 남는다(F5) |
| R3 | 기본 배송지를 삭제하면 기본이 0개가 된다 | 남은 것 중 **가장 최근에 만든 것**(`createdAt` 내림차순, 동률이면 `id` 내림차순)을 자동 승격한다. 규칙은 `src/profile/default-address.ts` 한 곳에 있고 F3d 가 고정한다. 마지막 한 건이었다면 승격 대상이 없으므로 기본도 없다 — 배송지가 0건인 상태에서는 불변식이 "기본은 최대 1개" 로 읽힌다 |
| R4 | `ADMIN_SUPER` 가 `profile.*:any` 를 자동으로 얻는다 | `/me` 경로에 `userId` 가 없어 대상이 언제나 자기 자신이다. 다만 `/me/addresses/:id` 는 **id 를 받으므로** 스코프 검사만으로는 `any` 그랜트가 통과한다 — 그래서 서비스가 **대상 행의 소유자가 호출자인지**를 한 번 더 보고, 아니면 `out_of_scope` 403 을 낸다. F6 이 `ADMIN_SUPER` 로도 확인한다 |
| R5 | **`ADMIN_OPERATOR` · `DEMO_ADMIN` 은 자기 프로필을 고칠 수 없다** — `profile.write` 를 갖지 않는다 | 코드가 맞고 4장 최초 서술이 틀렸다. 문서를 코드에 맞췄다. 콘솔 전용 계정이 마이페이지를 필요로 한다면 퍼미션 표를 고치는 별도 판단이 필요하다 — **오케스트레이터에게 보고** |

## 8. 확정된 버전

새 의존성 없음.

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-03 | 최초 작성. D-208 에 따라 TASK-0027 에서 분할. 스토어 설정은 TASK-0108 로 이관 |
| 2026-09-04 | **구현 착수 전 계약 정정.** 승인본(2026-09-03)이 지금 코드와 어긋나거나 구현자가 임의로 정해야 할 곳이 남아 있어, 코드를 쓰기 전에 문서를 고쳤다. ① **역할별 권한** — "`DEMO_ADMIN` 도 자기 프로필을 고칠 수 있다" 는 퍼미션 표(`profile.*` 를 `ADMIN_*` 에 주지 않음)와 모순이라 역할×엔드포인트 표로 대체(R5). ② **`profileResponseSchema`** — 라우트 표의 "프로필 + 설정 조회" 와 절단면 표의 필드 목록이 어긋나 `{ profile, preference }` 로 감싸고 `profileSchema` 를 분리. `addressResponseSchema` · `userPreferenceResponseSchema` · `withdrawalResponseSchema` · `DEFAULT_USER_PREFERENCE` 를 절단면에 추가(응답 스키마 없이는 C3 를 걸 수 없다). ③ **F5** — "로그인 401 · 주문 이력 조회 가능" 은 검증 불가능한 서술이었다. 로그인은 OAuth 리다이렉트라 401 이 아니고, `Order` 테이블은 M07 에 생긴다. 실제로 확인 가능한 것(계정 행 잔존 · 이력 참조 잔존 · 재로그인 시 새 계정)으로 바꿨다. ④ **기본 배송지 규칙** — 생성·지정·삭제 세 순간과 충돌 시 409 를 명시(원문은 "다음 배송지" 의 순서를 정하지 않았다). ⑤ **A5** — `GET /me` 는 배송지를 싣지 않으므로 측정 대상을 `GET /me/addresses` 로 정정. ⑥ **라우트 표에 성공 상태·응답 스키마·실패 계약** 추가. ⑦ **밀도 승격** 은 별도 엔드포인트가 아님을 2장에 명시. ⑧ **R1 을 ① 로 확정**, **5장 2번은 `89b1e50` 에서 이미 완료** 임을 명시 |
