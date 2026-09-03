# TASK-0111: 프로필 · 배송지 · 사용자 설정 API

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M04 인증·계정 |
| 상태 | 승인 대기 |
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
- **밀도 서버 승격 API** — 비로그인 localStorage 값을 로그인 시 서버로 올리는 엔드포인트
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

| 메서드 · 경로 | 용도 | 퍼미션 |
| --- | --- | --- |
| `GET /api/v1/me` | 프로필 + 설정 조회 | `user.read:own` |
| `PATCH /api/v1/me` | 프로필 수정 (이름 · 아바타) | `profile.write:own` |
| `GET /api/v1/me/preferences` | 표시·알림 설정 조회 | `user.read:own` |
| `PATCH /api/v1/me/preferences` | 설정 수정 (밀도 승격 포함) | `profile.write:own` |
| `GET /api/v1/me/addresses` | 배송지 목록 | `user.read:own` |
| `POST /api/v1/me/addresses` | 배송지 추가 | `profile.write:own` |
| `PATCH /api/v1/me/addresses/:id` | 배송지 수정 | `profile.write:own` |
| `DELETE /api/v1/me/addresses/:id` | 배송지 삭제 | `profile.write:own` |
| `POST /api/v1/me/addresses/:id/default` | 기본 배송지 지정 | `profile.write:own` |
| `DELETE /api/v1/me` | 회원 탈퇴 | `profile.delete:own` |

`/me` 로 묶는 이유: 경로에 `userId` 가 없으면 **다른 사람 것을 요청할 방법 자체가 없다.** 스코프 검사는
그 위의 두 번째 방어선이다.

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
| `googleSub` | 그대로 둔다 | 부분 유니크 인덱스(`WHERE "deletedAt" IS NULL`)가 재가입을 이미 허용한다. 값 삭제는 TASK-0025 의 파기 절차 |

### 데이터 모델 변경

**없다.** `User`(name · avatarUrl · deletedAt) · `Address` · `UserPreference` 모두 TASK-0020 이 만들었다.
따라서 **4장 데이터 게이트는 해당 없음**이며, **S5 만 자발적으로 적용**한다.

### 절단면 — `packages/shared` 의 zod 스키마

이 TASK 가 **정의**하고 그대로 응답한다. TASK-0112 가 **같은 스키마로 모킹 데이터를 만든다.**

| 스키마 | 내용 | 쓰는 곳 |
| --- | --- | --- |
| `profileResponseSchema` | id, email, name, avatarUrl, isDemo, roles | 0111 · 0112 |
| `profileUpdateRequestSchema` | 이름 · 아바타 수정 본문 | 0111 · 0112 |
| `addressSchema` | 배송지 1건 (id, label, recipientName, phone, postalCode, addressLine1/2, isDefault) | 0111 · 0112 · (M07 주문서) |
| `addressCreateRequestSchema` | 배송지 생성 본문 (`isDefault` 포함) | 0111 · 0112 |
| `addressUpdateRequestSchema` | 배송지 수정 본문 (부분 갱신) | 0111 · 0112 |
| `addressListResponseSchema` | `{ items: addressSchema[] }` | 0111 · 0112 |
| `userPreferenceSchema` | density, locale, currency, notifyOrder, notifyClaim, notifyMarketing | 0111 · 0112 |
| `userPreferenceUpdateRequestSchema` | 설정 수정 본문 (부분 갱신) | 0111 · 0112 |

`addressSchema` 는 **M07 주문서(TASK-0050)가 그대로 재사용할 절단면**이기도 하다. 우편번호는 한국식
5자리 문자열로 스키마에 못 박고, 전화번호 형식도 여기에만 적는다.

### 역할별 권한

전 역할이 자기 계정에 대해서만 동작한다. 판매자·관리자도 사람이므로 같은 엔드포인트를 쓴다.
`DEMO_ADMIN` 도 자기 데모 계정의 프로필을 고칠 수 있다 — `/me` 는 언제나 자기 자신이다.

## 5. 구현 계획

1. `packages/shared` 에 절단면 스키마 8종 정의 + `index.ts` export
2. `profile.write` · `profile.delete` 퍼미션 추가, 그랜트 반영, 매트릭스 재생성
3. 프로필 조회·수정 API
4. 사용자 설정 API (밀도 · 알림 · locale · currency)
5. 배송지 CRUD API (`own` 스코프 검사)
6. 기본 배송지 전환 (트랜잭션 · 부분 유니크 인덱스 의존)
7. 탈퇴 처리 (소프트 삭제 + 배송지 하드 삭제 + 토큰 revoke)
8. 실제 PostgreSQL 통합 테스트 — 동시 기본 지정, 위반 INSERT 거부, 탈퇴 후 조회

## 6. 완료 기준 (Definition of Done)

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 프로필 수정 | `PATCH /me` 로 이름 변경 후 `GET /me` | 변경값 반환 | [ ] |
| F2 | 배송지 추가 | 3건 생성 후 목록 조회 | 3건 반환, 각 항목이 `addressSchema` 통과 | [ ] |
| F3 | 기본 배송지 전환 | 다른 배송지를 기본으로 지정 | 이전 기본 해제, `isDefault=true` 가 정확히 1건 | [ ] |
| F3b | 기본 배송지 동시 지정 | 서로 다른 두 배송지에 기본 지정을 동시 호출 | 한 건 성공·한 건 실패, `isDefault=true` 1건 유지 (A7) | [ ] |
| F3c | DB 강제 확인 | `isDefault=true` 인 두 번째 행을 psql 로 직접 INSERT | **DB 가** 거부 (S5) | [ ] |
| F4 | 밀도 승격 | `PATCH /me/preferences` 로 `MAXIMAL` 저장 후 다른 세션에서 조회 | 같은 값 반환 | [ ] |
| F5 | 탈퇴 | `DELETE /me` 실행 | 로그인 401, 주문 이력 조회 가능, `Address` 행 0건 | [ ] |
| F6 | 남의 배송지 | 다른 사용자의 배송지 id 로 `PATCH` | 403 (`own` 스코프) | [ ] |
| F7 | 알림 설정 | 마케팅 수신 끄기 | 재조회 시 `notifyMarketing=false` | [ ] |
| F8 | 탈퇴 후 세션 | 탈퇴 직후 기존 refresh 토큰으로 갱신 시도 | 401 | [ ] |
| F9 | 매트릭스 재생성 | `pnpm --filter @shopping/api docs:matrix` 후 `git diff` | `profile.write`·`profile.delete` 반영, `permission-matrix.spec.ts` 통과 | [ ] |

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

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| A1 | 응답 시간 | 배송지 목록 p95 | 300ms 이하 | [ ] |
| A2 | 입력 검증 | 우편번호 4자리 · 알 수 없는 밀도값 | 400 + 통일된 에러 포맷 | [ ] |
| A3 | 권한 | 퍼미션 없는 주체로 `PATCH /me` 호출 | 403 | [ ] |
| A4 | 인증 | 토큰 없이 호출 | 401 | [ ] |
| A5 | N+1 | 프로필+설정+배송지 동시 조회 쿼리 로그 | 배송지 건수와 무관하게 쿼리 수 일정 | [ ] |
| A6 | 실 DB | 서비스·API 테스트 실행 대상 | Prisma 모킹 0건, 실제 PostgreSQL | [ ] |
| A7 | 동시 요청 | F3b | 기본 배송지 2개 발생 0건 | [ ] |
| S5 | 제약 강제 | F3c | **DB 가** 거부 | [ ] |
| C1 | 스키마 단일 출처 | 응답 DTO 출처 확인 | 전부 `packages/shared` 의 zod 스키마 | [ ] |
| C3 | 실제 응답 검증 | 통합 테스트에서 실제 응답을 `addressSchema` 등으로 `parse` | 전부 통과 | [ ] |

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
| R1 | **프로필의 "연락처"를 저장할 컬럼이 없다.** 원본 TASK-0027 은 프로필에 연락처를 넣었지만 `User` 에 전화번호 컬럼이 없다 | 이 TASK 는 **스키마를 바꾸지 않는다.** 승인 시 둘 중 하나를 정한다 — ① 연락처는 배송지(`Address.phone`)에만 두고 프로필에서 뺀다(권장 — 주문서가 쓰는 값이 배송지의 것이므로 두 벌이 생기지 않는다), ② `User.phone` 을 추가한다. ②면 `schema.prisma` 를 건드리는 **별도 TASK 로 분리**한다(병행 규칙 1) |
| R2 | 탈퇴한 사용자의 개인정보가 배송지에 남는다 | 탈퇴 시 배송지는 **하드 삭제**한다. 주문의 수령인 스냅샷만 남는다(F5) |
| R3 | 기본 배송지를 삭제하면 기본이 0개가 된다 | 마지막 배송지가 아니면 삭제 시 다음 배송지를 자동 승격한다. 규칙을 서비스 한 곳에 두고 F3 과 같은 테스트로 고정한다 |
| R4 | `ADMIN_SUPER` 가 `profile.*:any` 를 자동으로 얻는다 | `/me` 경로에 `userId` 가 없어 대상이 언제나 자기 자신이다. 남의 계정 편집은 `user.write` 경로이며 이 TASK 의 범위가 아니다 |

## 8. 확정된 버전

새 의존성 없음.

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-03 | 최초 작성. D-208 에 따라 TASK-0027 에서 분할. 스토어 설정은 TASK-0108 로 이관 |
