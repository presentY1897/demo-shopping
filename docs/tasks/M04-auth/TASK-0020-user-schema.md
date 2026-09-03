# TASK-0020: 사용자 · 역할 스키마

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M04 인증·계정 |
| 상태 | 완료 |
| 작성일 | 2026-09-02 |
| 브랜치 | `feature/user-schema` |
| 선행 작업 | **M01 완료** (원래 M03 로 적혀 있었으나 스키마 정의에 디자인 시스템은 필요하지 않다) |

## 1. 목적

사용자·역할·판매자 스키마를 만든다. 역할을 다대다로 두어 한 사람이 구매자이면서 판매자일 수 있게 한다.

## 2. 범위

### 포함
- `User` — `googleSub`, 이메일, 이름, 아바타, `isDemo`, `demoExpiresAt`, `deletedAt`
- `UserRole` — **BUYER / SELLER_OWNER / ADMIN_OPERATOR / ADMIN_SUPER / DEMO_ADMIN** (다대다). 퍼미션 매핑은 TASK-0105
- `Seller` — 브랜드명, 소개, 로고, 상태(PENDING/ACTIVE/REJECTED/SUSPENDED), 개별 수수료율
- `Address` — 배송지, 기본 배송지 플래그
- `UserPreference` — 밀도, 언어, 통화, 알림 설정
- `RefreshToken` — `app`(SHOP/SELLER/ADMIN) 구분 포함
- 인덱스 및 마이그레이션

### 제외
- 인증 로직 (TASK-0021, 0022)
- 화면 (TASK-0023, 0027)

## 3. 요구사항

- [x] 한 사용자가 여러 역할을 동시에 가질 수 있다
- [x] 같은 Google 계정으로 중복 가입이 불가능하다
- [x] 사용자당 기본 배송지는 1개만 존재한다
- [x] 데모 계정과 일반 계정이 구분된다

## 4. 설계

상세는 `docs/design/erd.md` 1장 참조.

| 제약 | 이유 |
| --- | --- |
| `User.googleSub` **부분** 유니크 (`WHERE deletedAt IS NULL`) | 살아있는 계정은 Google 계정당 1개. 평범한 유니크면 탈퇴자의 남은 행이 그 계정을 영구 점유해 재가입이 막힌다 |
| `UserRole(userId, role)` unique | 역할 중복 방지 |
| 역할 → 퍼미션 매핑 | **코드 상수** (DB 아님). TASK-0105 참조 |
| `Address` 기본값 부분 유니크 인덱스 (`WHERE isDefault`) | 사용자당 기본 배송지 1개. 서비스 검증만으로는 동시 요청 둘이 모두 0개를 읽고 모두 1개를 쓴다 |
| `User_demo_expiry_check` | 데모에는 만료가 있고 실계정에는 없다 — 만료 스윕이 실계정을 지우지 못하게 |
| `User_google_identity_check` | 살아있는 실계정에는 Google 신원이 있다 |
| `Seller_commissionRateBp_check` | 수수료율 0~10000 bp. 정산이 곱하는 값이라 범위를 DB 가 막는다 |
| `RefreshToken(userId, app)` 인덱스 | 앱별 세션 조회 |
| `RefreshToken.tokenHash` unique | 토큰 원문 대신 해시만 저장하고, 같은 해시를 두 번 두지 않는다 |

**역할을 다대다로 두는 이유**: 판매자도 물건을 산다. 단일 컬럼이면 판매자가 구매자 앱을 쓸 수 없거나 계정을 두 개 만들어야 한다.

**수수료율의 표현**: **basis point 정수**(1bp = 0.01%, `350` = 3.50%). 금액이 정수(원)인데 비율만 부동소수면 정산에서 오차가 다시 들어온다. NULL 은 "개별율 없음"이며 카테고리 기본율이 적용된다(`docs/design/pricing.md` 5장).

**PSL 로 표현할 수 없는 제약**은 마이그레이션에 직접 SQL 로 적었다. Prisma 7 의 드리프트 검사는 부분 인덱스와 CHECK 제약을 무시하므로(`prisma migrate diff --from-config-datasource --to-schema` 결과가 빈 마이그레이션), 이후 `migrate dev` 가 이것들을 지우려 들지 않는다. 확인은 `apps/api/src/prisma/schema-guards.spec.ts` 가 자동화한다.

상세 근거는 `docs/design/erd.md` 1장 "설계 판단".

## 5. 구현 계획

1. Prisma 스키마 정의
2. 인덱스·유니크 제약 — PSL 로 표현되지 않는 부분 유니크 2개와 CHECK 3개는 마이그레이션 SQL 에 직접 작성
3. 마이그레이션 생성·적용
4. ~~시드에 관리자 계정 1개 추가~~ → **TASK-0037(시드 데이터 생성기)로 이관.** 관리자 계정은 실제 Google `sub` 값이 있어야 만들어지고 그 값은 환경 비밀값이라 커밋할 수 없다. 로그인 흐름(TASK-0021)이 생긴 뒤 시드에서 다루는 것이 맞다.
5. ~~리포지토리 계층 기본 메서드~~ → **만들지 않는다.** `PrismaService` 가 `PrismaClient` 를 상속해 `prisma.user.findMany()` 를 래퍼 없이 노출하도록 M01 에서 정했다. 지금 리포지토리를 만들면 모델 델리게이트를 그대로 재노출하는 빈 클래스가 되고, 실제 조회 조건을 아직 모른다. 조건이 정해지는 TASK-0021·0026·0027 에서 서비스와 함께 만든다.

## 6. 완료 기준

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 결과 | 충족 |
| --- | --- | --- | --- | --- | --- |
| F1 | 마이그레이션 | 빈 DB `shopping_s1` 생성 후 `pnpm db:deploy` | 성공 | 마이그레이션 2건 적용, 테이블 8개 생성 | [x] |
| F2 | 다중 역할 | 한 사용자에 BUYER+SELLER_OWNER 부여 | 정상 저장 | `{BUYER,SELLER_OWNER}` 조회됨 | [x] |
| F3 | 중복 가입 차단 | 같은 `googleSub` 로 2회 삽입 | 유니크 위반 | `duplicate key ... "User_googleSub_active_key"` | [x] |
| F4 | 기본 배송지 유일성 | 기본 배송지 2개 삽입 시도 | 제약 위반 | `duplicate key ... "Address_userId_default_key"` | [x] |
| F5 | 데모 구분 | `isDemo=true` 조회 | 필터링 동작 | 만료분만 반환, `User_isDemo_demoExpiresAt_idx` 사용 | [x] |

검증에 쓴 SQL 과 출력 전문은 PR 본문에 있다. 확인한 반대 방향까지 적으면 —
같은 역할 중복 부여 거부, 소프트 삭제 뒤 **같은 Google 계정으로 재가입 성공**(그러나 살아있는 계정은 여전히 1개),
기본이 아닌 배송지는 다수 허용·다른 사용자는 자기 기본 배송지를 따로 보유, 데모 만료시각 누락 거부,
실계정의 만료시각 부여 거부, 실계정의 Google 신원 누락 거부, 수수료율 `10001`·`-1` 거부,
낙관적 잠금이 옛 버전 갱신을 0행으로 만들고, `Seller` 를 가진 계정의 물리 삭제가 `Restrict` 로 실패한다.

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 예외:
- **4장 데이터 게이트 전 항목 적용** (S1~S4)
- **2장 화면 게이트 해당 없음**
- **3장 API 게이트 해당 없음** — 엔드포인트 없음

| # | 기준 | 결과 | 충족 |
| --- | --- | --- | --- |
| Q1 | `pnpm typecheck` | error 0 | [x] |
| Q2 | `pnpm lint` | error 0 · warning 0 | [x] |
| Q3 | `pnpm build` | 전 패키지 성공 | [x] |
| Q4 | `pnpm test` | 75 통과 (0020 이전 65 + 신규 10) | [x] |
| Q5 | 커버리지 | M05 부터 적용 — 면제 | — |
| Q6 | CI | PR 의 GitHub Actions | [x] |
| Q7 | commitlint | 위반 0 | [x] |
| S1 | 마이그레이션 | 빈 DB 에 `db:deploy` 성공 | [x] |
| S2 | 롤백 가능성 | **전부 신규 테이블 생성. 기존 데이터를 변형하거나 삭제하는 문장이 없다** — 되돌리는 방법은 이 마이그레이션이 만든 테이블·타입을 DROP 하는 것뿐이고, 그때 사라지는 데이터는 이 마이그레이션 이후에 들어온 것뿐이다. 기존 `AppMeta` 는 손대지 않는다 | [x] |
| S3 | 인덱스 | 조회 경로 13개를 `EXPLAIN` 으로 확인 (`enable_seqscan=off`) — 전부 인덱스 스캔 | [x] |
| S4 | 금액·비율 컬럼 | `information_schema` 전수 조회 결과 부동소수 컬럼 0건. 숫자 컬럼은 `Seller.commissionRateBp`(integer, bp)·`Seller.version`(integer) 뿐 | [x] |

Q1~Q4 와 `pnpm format:check` 는 로컬에서 전부 exit 0. S1·S3·S4 는 실제 SQL 출력으로 확인했고,
S4 는 `apps/api/src/prisma/schema-guards.spec.ts` 가 회귀 방지용으로 자동화한다 (부동소수 타입이 스키마에
들어오면 테스트가 깨진다).

### 6.3 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태 갱신 + 인덱스 2곳 | [x] |
| D2 | 실제 스키마와 `docs/design/erd.md` 1장 일치 확인 | [x] |
| D5 | 새 라이브러리 — 없음 (8장) | [x] |

- D1 의 인덱스 2곳(`docs/tasks/README.md`, `docs/tasks/M04-auth/README.md`)은 이 브랜치의 파일 소유권 밖이라 **오케스트레이터가 갱신**한다. 이 문서의 상태·본문 갱신은 여기서 끝냈다.
- D2 는 `erd.md` 1장에 "설계 판단" 절을 넣어 맞췄다. 컬럼 타입은 `schema.prisma` 에만 두고 `erd.md` 에는 관계와 근거만 남겼다(4장 설계 문서 규칙).
- D3 해당 없음 — 새 결정 없음. D4 해당 없음 — 새 환경변수 없음.

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | 데모 계정 삭제 시 참조 무결성 | 주문 등은 스냅샷을 남기고 `User` 는 소프트 삭제. 개인 데이터 하위 테이블은 `Cascade`, `Seller` 는 `Restrict` 로 두어 물리 삭제가 조용히 카탈로그를 지우지 못하게 했다. 정리 절차 확정은 TASK-0025 |
| R2 | `googleSub` 조회에 `findUnique` 를 쓸 수 없다 | 유니크가 부분 인덱스라 PSL 에 `@unique` 가 없다. 로그인은 `findFirst({ googleSub, deletedAt: null })` 로 조회한다 — 탈퇴 계정으로 로그인되지 않아야 하므로 오히려 이쪽이 맞다. TASK-0021 에서 준수 |
| R3 | `packages/shared` 의 공용 타입 부재 | 역할·앱 구분은 지금 Prisma 가 생성한 enum 뿐이라 프런트가 참조할 수 없다. API 가 생기는 TASK-0021·0022 에서 `packages/shared` 에 zod 스키마로 옮긴다 |

## 8. 확정된 버전

새로 추가한 의존성은 없다. 이 TASK 를 검증한 조합은 다음과 같다.

| 항목 | 버전 |
| --- | --- |
| Prisma (CLI · `@prisma/client` · `@prisma/adapter-pg`) | 7.10.0 |
| PostgreSQL | 17.11 |
| Node | 24.13.1 |
| pnpm | 9.15.9 |
| TypeScript | 6.0.3 |
| NestJS | 12.0.1 |
| Vitest | 4.1.11 |
| zod | 4.5.4 |

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-02 | 최초 작성 |
| 2026-09-03 | 완료. 계정·역할·판매자·배송지·설정·세션 6개 모델과 마이그레이션 추가. PSL 로 표현되지 않는 부분 유니크 2개·CHECK 3개는 마이그레이션 SQL 로 작성. 구현 계획 4(관리자 시드)는 TASK-0037 로 이관하고 5(리포지토리 계층)는 만들지 않기로 변경 |
