# TASK-0115: 판매자 상품 목록 · 재고 조정 API

| 항목 | 내용 |
| --- | --- |
| 마일스톤 | M05 카탈로그 |
| 상태 | 승인됨 |
| 작성일 | 2026-09-03 |
| 브랜치 | `feature/product-list-stock-api` |
| 선행 작업 | TASK-0113, TASK-0036, TASK-0106 |

> **분할 유래** — TASK-0035(판매자 상품 목록 · 재고 관리)의 백엔드 절반이다. D-208 에 따라 화면과 API 를
> 나눴고, 화면은 TASK-0116 이 맡는다. 원본은 목록 조회 API 와 재고 조정 API 를 화면과 한 문서에 담고
> 있어 3장 API 게이트와 2장 화면 게이트를 동시에 받고 있었다.

## 1. 목적

판매자가 자기 상품을 관리하는 데 필요한 **조회 · 조정 API** 를 만든다. **재고 수정이 반드시 원장을
거치도록 강제**하는 것이 이 API 의 존재 이유다.

## 2. 범위

### 포함
- **상품 목록 API** — 상태 · 카테고리 · 재고 필터, 이름 검색, **커서 페이지네이션**
- **목록 집계값** — 총재고 · 최저가 · 품절 임박 여부. Variant 전체를 로드하지 않는다
- **품절 임박 기준** — `packages/shared` 의 상수 하나(기본: 가용재고 ≤ 5)를 필터와 표시가 공유
- **Variant 재고 조정 API** — **조정량(delta) 입력**. TASK-0036 의 재고 서비스를 그대로 호출해
  `StockLedger` 에 기록
- **Variant 목록 조회 API** — 특정 상품의 Variant 별 현재 재고
- **일괄 상태 변경 API** — 여러 상품을 판매중지 · 재개
- **상품 복제 API** — 옵션 · Variant 포함 복제, 결과는 `DRAFT`. 재고는 복제하지 않는다
- 소유권(`product.*:own`) · 판매자 상태 검사
- 절단면이 되는 zod 스키마를 `packages/shared` 에 정의

> **착수 시 정정 (2026-09-05).** 승인본은 2026-09-03 작성분이라 그 뒤에 머지된 TASK-0036 ·
> TASK-0113 의 실물과 어긋난 곳이 있었다. 코드보다 문서를 먼저 고쳤고, 고친 것과 이유는 4장
> 각 절과 9장 변경 이력에 있다. 요약하면 넷이다 — **재고 이력 조회는 이미 있다**(TASK-0036 이
> 열었다), **`variantStockSchema` 는 이미 다른 뜻으로 쓰인다**, **원장 행에는 전역 id 가 없다**,
> **`adjustStock` 이라는 이름의 함수는 없다**(`StockService.adjust`).

### 제외 (이번에 하지 않는 것)
- **상품 목록 · 재고 관리 화면** → TASK-0116
- **재고 원장 자체(테이블 · `StockService` · 행 잠금)** → TASK-0036. 이 API 는 그것을 호출만 한다
- **재고 이력 조회 API** → TASK-0036 이 `GET /api/v1/variants/:id/ledger` 로 **이미 열었다.**
  이 TASK 는 그 경로를 만들지 않고 재사용한다
- **상품 생성 · 수정** → TASK-0113. 복제는 그 쓰기 경로를 재사용한다
- 주문 관리 → M09
- 예약(`StockReservation`) 연동 → M07
- `schema.prisma` 변경 → 상품은 TASK-0032, 원장은 TASK-0036 이 소유한다

## 3. 요구사항

### 기능 요구사항
- [ ] 자기 상품만 목록에 나온다
- [ ] 상태 · 카테고리 · 재고로 목록을 걸러낼 수 있다
- [ ] 재고 조정이 항상 원장에 기록된다
- [ ] 재고를 **절대값이 아니라 조정량**으로 받는다
- [ ] 조정과 판매가 동시에 일어나도 최종 재고가 원장 합계와 일치한다
- [ ] 품절 · 품절 임박 상품을 필터로 찾을 수 있다
- [ ] 여러 상품의 상태를 한 번에 바꿀 수 있다
- [ ] 상품을 복제하면 옵션 · Variant 가 함께 복제되고 `DRAFT` 로 생성된다
- [ ] 100건에서 커서로 넘겨도 중복 · 누락이 없다

### 비기능 요구사항
- 목록 조회에 **N+1 이 없어야 한다** — 상품 · Variant · 이미지 조인이 원본이 지적한 위험 지점이다
- 재고 조정은 TASK-0036 의 행 잠금 경로를 벗어나지 않는다 (직접 `UPDATE` 금지)

## 4. 설계

### API / 라우트

| 메서드 · 경로 | 용도 | 퍼미션 | 이 TASK 가 |
| --- | --- | --- | --- |
| `GET /api/v1/seller/products?status=&categoryId=&stock=&q=&cursor=&limit=` | 상품 목록 (집계값) | `product.read:own` | 만든다 |
| `GET /api/v1/seller/products/:id/variants` | Variant 목록 + 현재 재고 | `product.read:own` | 만든다 |
| ~~`GET /api/v1/seller/variants/:id/ledger`~~ → **`GET /api/v1/variants/:id/ledger`** | 재고 변동 이력 | `product.read:own` | **이미 있다** (TASK-0036) |
| `POST /api/v1/variants/:id/stock-adjustments` | 재고 조정 (조정량) | `product.write:own` | 만든다 |
| `POST /api/v1/seller/products/status` | 일괄 상태 변경 (200) | `product.write:own` | 만든다 |
| `POST /api/v1/seller/products/:id/duplicate` | 상품 복제 (201) | `product.write:own` | 만든다 |

**이력 조회는 이미 열려 있다.** TASK-0036 이 `StockController` 에 `GET /variants/:id/ledger` 를
만들면서 그 파일 머리말에 "조정 엔드포인트는 여기 없다 — 그것을 부르는 콘솔 경로는 TASK-0115 의
것" 이라고 적어 뒀다. 그래서 이 TASK 가 여는 것은 **조정 쪽 하나**이고, 이력은 F9 에서 그대로
호출해 검증한다. 조정 라우트는 `apps/api/src/catalog/` 에 두는 별도 컨트롤러가 같은 `variants`
경로에 붙인다 — 소유 경로를 넘지 않으면서 리소스 이름을 지키는 방법이고, 두 컨트롤러가 같은
접두사를 공유하는 것은 Nest 가 허용한다(핸들러가 겹치지 않는 한).

**관리자는 `/seller/` 경로를 쓰지 않는다.** 이 세 상품 경로는 요청자의 **자기 스토어**로만
좁혀지므로, `sellerId` 가 없는 principal 은 `product.read:any` 를 들고 있어도 403
(`out_of_scope`)이다. 스토어를 지정해 남의 상품을 보는 일은 `GET /api/v1/products?sellerId=`
(TASK-0032)가 이미 한다.

**새 퍼미션은 없다.** `product.read` · `product.write` 를 `SELLER_OWNER:own` 으로 이미 가진다.

**Variant 경로에서 `/seller` 를 뺐다.** [TASK-0036](./TASK-0036-stock-ledger.md) 이 원장 조회를
`GET /api/v1/variants/:id/ledger` 로 먼저 열었고, 그것이 이 저장소의 관례와 맞다 — 컨트롤러가
전부 리소스 이름을 쓴다(`attributes` · `categories` · `products` · `variants` · `uploads`).
`/seller` 접두사를 쓰는 컨트롤러는 하나도 없다.

**원장은 콘솔의 데이터가 아니라 Variant 의 데이터다.** 누가 읽을 수 있는지는 경로가 아니라
퍼미션(`product.read:own`)이 정하고, 관리자가 같은 원장을 볼 때 경로가 달라질 이유가 없다.
`products` 쪽 경로는 판매자 화면 전용 집계라 `/seller` 를 유지한다.

### 재고는 조정량으로 받는다

```
현재 12개 → "+5 입고" → 원장에 +5 기록 → 결과 17
```

절대값(`stock = 17`)을 받으면 **그 사이에 팔린 수량을 덮어쓴다.** "+5 입고"는 언제 처리되든 결과가
맞는다. TASK-0036 이 같은 이유를 원장 쪽에서 적어 뒀다.

요청 본문은 `{ delta, type, reason }` 이고, 서버는 그대로 `StockService.adjust` 에 넘긴다. **이 API 는
재고를 직접 쓰지 않는다** — 쓰는 순간 원장 합계와 현재 재고가 어긋날 수 있는 두 번째 경로가 생긴다.
그 규칙은 이미 `test/db/stock-single-path.spec.ts` 가 지키고 있고(F8), 이 TASK 는 그 검사에
새 파일이 걸리지 않도록 만드는 것이 전부다.

**`type` 은 판매자가 콘솔에서 쓸 수 있는 둘로 좁힌다 — `INBOUND` 와 `ADJUST`.** 원장의 유형은
여섯이지만 나머지 넷(`SALE` · `CANCEL` · `RETURN_IN` · `RESERVE_CONFIRM`)은 **주문이 설명하는
변동**이고 `refType`/`refId` 로 그 주문 항목을 가리킨다. 콘솔에서 참조 없는 `SALE` 을 적을 수 있게
하면 어떤 주문도 설명하지 못하는 판매가 원장에 남고, 그것은 대사가 "맞다" 고 말하는데 장부가 거짓인
유일한 모양이다. 사유(`reason`)의 필수 여부는 유형이 정하고 그 판정은 TASK-0036 의
`movementIssues` 가 이미 갖고 있으므로 스키마에서 다시 쓰지 않는다 — 두 곳에 적으면 갈린다.

**응답은 `{ variantId, delta, balanceAfter, seq }` 다.** 승인본은 `ledgerId` 라고 적었는데 **그런
컬럼은 없다.** 원장 행의 자리는 `(variantId, seq)` 이고 전역 id 를 두지 않는 것이 TASK-0036 의
결정이다(`docs/design/erd.md` 3장 — 행들 사이의 순서 자체가 데이터라 UUIDv7 이 같은 밀리초 안에서
순서를 정해 주지 못한다). `seq` 가 그 행의 신원이자 이력 페이지의 커서이므로, 화면은 이것 하나로
방금 적힌 행을 이력에서 찾을 수 있다.

### 목록은 집계값만

원본 TASK-0035 의 R1 이 지적한 그대로다 — 목록에서 Variant 를 전부 로드하면 N+1 이 된다.

| 목록이 주는 것 | 목록이 주지 않는 것 |
| --- | --- |
| 총재고(Variant 재고 합), 최저가, 품절 임박 플래그, 대표 이미지 1장, 상태 | Variant 개별 행, 옵션 조합, 전체 이미지 |

Variant 는 `GET /seller/products/:id/variants` 로 따로 가져간다.

**집계는 lateral join 으로 한 문장 안에서 한다** — TASK-0032 의 `ProductService.list` 가 이미 같은
모양이고(변형 수 · 재고 합 · 대표 이미지), 이 목록은 거기에 필터 셋과 이름 검색을 더한다. 상품 수와
무관하게 문장 수가 1 이어야 하는 것이 A5 이고, 상품 5건과 100건에서 실제로 세어 증명한다.

**최저가는 `Product.minPrice` 를 그대로 읽는다.** 그 컬럼은 TASK-0032 가 쓰기마다 Variant 에서
다시 계산해 두는 파생값이라(누산이 아니다), 목록이 Variant 를 다시 훑을 이유가 없다. 팔 수 있는
Variant 가 하나도 없으면 `null` 이고 그것이 정확한 답이다.

**Variant 목록도 한 문장이다.** 옵션 라벨("블랙 / M")은 매핑 테이블을 축 순서로 모으는 lateral
join 으로 만든다 — Variant 마다 조합을 다시 물으면 그것이 바로 R1 이 말한 N+1 이고, 조합 화면은
Variant 가 200개까지 갈 수 있는 곳이다.

### 품절 임박 기준

```ts
// packages/shared
export const LOW_STOCK_THRESHOLD = 5
```

원본 TASK-0035 는 "품절 임박 기준 정의 및 표시"를 구현 계획에만 남기고 값을 정하지 않았다. 값을 정하지
않으면 **필터의 기준과 배지의 기준이 갈린다.** 상수 하나를 절단면에 두고 API 필터와 화면 배지가 같은
값을 읽는다.

**갈리는 것은 숫자만이 아니라 술어다.** 승인본대로 "가용재고 ≤ 5" 를 그대로 쓰면 재고 0 인 상품이
품절 필터와 품절 임박 필터에 **둘 다** 걸리고, 그러면 배지는 둘 중 하나를 골라야 한다 — 그 고르는
규칙이 화면에 생기는 순간 상수를 공유한 의미가 없어진다. 그래서 술어를 세 갈래로 못박고 API 와
화면이 그것을 공유한다.

| 단계 | 조건 | 목록 필터 | 배지 |
| --- | --- | --- | --- |
| `out` | 총재고 = 0 | `stock=out` | 품절 |
| `low` | 0 < 총재고 ≤ `LOW_STOCK_THRESHOLD` | `stock=low` | 품절 임박 |
| `ok` | 총재고 > `LOW_STOCK_THRESHOLD` | (없음) | 없음 |

목록 1행의 `isLowStock` 은 **`low` 단계일 때만** 참이다. 두 필터는 겹치지 않고, 어떤 상품도 두
배지를 동시에 받지 않는다. 판정은 `apps/api` 의 순수 모듈 하나가 갖고 분기 100% 를 받는다 —
필터가 쓰는 경계와 배지가 쓰는 경계가 같은 함수에서 나오는지를 스펙이 0..10 전 구간에서 대조한다.

**그래서 `packages/shared` 로 나가는 것은 함수가 아니라 상수다.** Variant 1건에도 `isLowStock` 을
실어 보내는 이유가 이것이다 — 승인본의 필드 목록에는 없지만, 싣지 않으면 조합 표의 배지를 화면이
직접 판정해야 하고 그 순간 술어가 두 벌이 된다. `packages/shared` 에는 테스트 스크립트가 없어
거기 둔 판정 함수는 어떤 커버리지 게이트도 받지 못한다(Q5 의 순수 로직 행이 요구하는 분기 100%
를 걸 곳이 없다). 상수는 화면이 문구("재고 5개 이하")에 쓰고, 판정은 서버가 한 번만 한다.

**"가용재고" 는 지금 `stock` 과 같다.** 예약(`StockReservation`)은 M07 이고 이 TASK 의 제외
목록에 있다. 예약이 붙으면 총재고를 계산하는 SQL 한 곳과 술어 한 곳만 바뀐다.

### 복제

옵션 · Variant · 이미지 · 속성값을 복제하고 **재고는 0 으로 시작**한다. 재고를 복제하면 원장 없이
재고가 생겨 원장 합계와 어긋난다. 결과 상품은 `DRAFT` 이므로 판매되지 않는다.

**복제는 TASK-0113 의 생성 경로를 그대로 탄다.** 원본을 읽어 `createProductRequestSchema` 모양의
요청으로 옮긴 뒤 `ProductService.create` 를 부른다. 그래야 카테고리 검증 · 이미지 접두사 검사 ·
조합 전개 · SKU 발급 · `minPrice` 파생 · 초기 재고의 `INBOUND`(여기서는 0 이라 행이 생기지
않는다)가 **한 번만, 한 곳에서** 일어난다. 복제 전용 INSERT 를 쓰면 그 여섯 중 하나가 빠진 두
번째 쓰기 경로가 생기고, 빠진 것이 무엇인지는 나중에 알게 된다.

**SKU 는 복제하지 않고 새로 발급한다** (R5 의 "비운다" 쪽). `ProductVariant_seller_sku_key` 가
같은 판매자의 살아 있는 SKU 중복을 거부하므로 원본 SKU 를 그대로 쓰면 복제가 항상 409 다.
접미사를 붙이는 쪽은 규칙이 두 벌(생성기 · 복제기)이 되고, TASK-0113 이 이미 세운 기본 규칙
(`defaultSkuPrefix` + 난수 꼬리)이 충돌하지 않는 이름을 만들어 준다.

**이름은 `<원본 이름> (복사본)` 이고, 120자를 넘으면 앞을 자른다.** `productNameSchema` 의 상한을
넘겨 자기 요청이 400 으로 거절당하는 복제가 되지 않도록, 자르는 규칙도 순수 함수로 두고 분기
100% 를 받는다.

### 절단면 — `packages/shared` 의 zod 스키마

이 TASK 가 **정의**하고 그대로 응답한다. TASK-0116 이 **같은 스키마로 모킹 데이터를 만든다.**

| 스키마 | 내용 | 쓰는 곳 |
| --- | --- | --- |
| `sellerProductListQuerySchema` | 목록 질의 (status, categoryId, stock, q, cursor, limit) | 0115 · 0116 |
| `sellerProductListItemSchema` | 목록 1행 (id, name, status, totalStock, minPrice, isLowStock, thumbnailUrl) | 0115 · 0116 |
| `sellerProductListResponseSchema` | `{ items, nextCursor }` | 0115 · 0116 |
| `sellerVariantSchema` | Variant 1건 (id, sku, optionLabel, stock, isLowStock, maxPurchaseQuantity, isActive) | 0115 · 0116 |
| `sellerVariantListResponseSchema` | `{ variants }` | 0115 · 0116 |
| `stockAdjustRequestSchema` | `{ delta, type, reason }` — **delta 는 0이 아닌 정수** | 0115 · 0116 |
| `stockAdjustResponseSchema` | `{ variantId, delta, balanceAfter, seq }` | 0115 · 0116 |
| `productBulkStatusRequestSchema` | `{ productIds, status }` | 0115 · 0116 |
| `productBulkStatusResponseSchema` | `{ items }` — 바뀐 행들, 목록과 같은 모양 | 0115 · 0116 |
| `LOW_STOCK_THRESHOLD` | 품절 임박 기준 상수 | 0115 · 0116 |

`productStatusSchema` 는 TASK-0113 이 정의한 것을 그대로 쓴다.

**이름 셋이 승인본과 다르다. 전부 이미 쓰이고 있는 이름이라 그렇다.**

| 승인본 | 실제 | 왜 |
| --- | --- | --- |
| `variantStockSchema` | `sellerVariantSchema` | 그 이름은 **TASK-0036 이 이미 다른 뜻으로 쓴다** — `{ variantId, sku, stock, ledgerBalance, entryCount }`, 즉 이력 응답의 머리에 붙는 대사용 요약이다. 같은 이름에 다른 모양을 얹으면 배럴에서 `TS2300` 이 나거나(운이 좋을 때) 이력 화면이 조용히 다른 것을 파싱한다 |
| `stockLedgerEntrySchema` | — (신규 아님) | **TASK-0036 이 이미 정의했다.** 이 TASK 는 정의하지 않고 그대로 쓴다 |
| `stockAdjustResponseSchema.ledgerId` | `seq` | 원장 행에 전역 id 가 없다 (위 재고 절) |

**새 도메인 오류 코드는 없다.** 이 TASK 가 내는 실패는 전부 이미 코드를 가진 것들이다 —
소유권 위반은 `FORBIDDEN`, 스토어 상태는 `PRODUCT_SELLER_INACTIVE`, 복제의 SKU 충돌은
`PRODUCT_SKU_TAKEN`, 판매 시작 시 필수 속성 미입력은 `PRODUCT_ATTRIBUTES_REQUIRED`,
주문 가능한 옵션이 없으면 `PRODUCT_NOT_SELLABLE`, 재고 부족은 TASK-0036 의 409 다. 그래서 두
콘솔의 `Record<UserFacingErrorCode, string>` 카탈로그를 건드리지 않는다 — 코드를 하나 늘리면
`apps/admin` 의 문장까지 함께 늘어야 하고, 그 앱은 다른 TASK 의 소유다.

### 판매자 상태 검사는 `assertSellerActive` 를 부르지 않는다

TASK-0113 이 상품 쓰기에서 내린 것과 **같은 판단**이다. `assertSellerActive` 는 맨
`ForbiddenException` 을 던지고, 그 403 은 "이 상품은 당신 것이 아니다" 는 403 과 화면에서
구분되지 않는다 — 두 실패의 다음 행동이 정반대인데도. 그래서 판정 자체는 TASK-0108 의
`sellerStatusAllows` 로 하고 문장은 `sellerInactiveMessage` 에서 가져와
`PRODUCT_SELLER_INACTIVE` 를 실은 403 으로 던진다. 결정도 문구도 복제하지 않으면서 코드만
얹는다.

**쓰기에만 건다.** `SUSPENDED` 스토어도 자기 상품 목록은 볼 수 있어야 한다(F10) — 정지된 스토어를
관리 불가능하게 만드는 것은 정지가 의도한 바가 아니고, TASK-0108 의 표가 `product.write` 만
막는다고 말한다.

### 일괄 상태 변경은 한 트랜잭션이다

R4 가 요구하는 "부분 적용 없음" 은 두 겹으로 지킨다.

1. **검사를 전부 먼저 한다.** id 를 정렬해 차례로 행 잠금을 잡고, 소유권 · 스토어 상태 ·
   `SUSPENDED` 전이 권한을 **전부** 확인한 뒤에야 첫 쓰기를 한다. 정렬은 취향이 아니다 — 두
   판매자가 겹치는 목록을 동시에 바꾸면 잠금 순서가 다를 때 교착이 난다.
2. **그 전부가 한 트랜잭션 안이다.** 6번째 상품에서 `ACTIVE` 가 거절돼도 앞의 다섯은 롤백된다.

`ACTIVE` 로 가는 요청은 TASK-0113 의 발행 검사를 그대로 받는다 — 필수 속성이 비어 있으면
`PRODUCT_ATTRIBUTES_REQUIRED`, 주문 가능한 옵션이 없으면 `PRODUCT_NOT_SELLABLE`. 일괄이라고
느슨해지면 목록에서 체크박스를 켜는 것이 편집기를 우회하는 뒷문이 된다.

### 역할별 권한

| 역할 | 할 수 있는 것 |
| --- | --- |
| 판매자(SELLER_OWNER, `ACTIVE`) | 자기 상품 목록 · Variant · 이력 조회, 재고 조정, 일괄 상태 변경, 복제 |
| 판매자(그 외 상태) | 조회만. 쓰기는 403 (`assertSellerActive`) |
| 구매자(BUYER) | 없음 — 403 |
| 관리자 | `/seller/` 경로가 아니다. 전체 상품 조회는 M14(TASK-0095) |

## 5. 구현 계획

1. `packages/shared` 에 절단면 스키마 9종 + 상수 정의, `index.ts` · API 클라이언트 export
2. 순수 로직 두 모듈 — 재고 단계 판정(`stock-levels.ts`)과 복제 요청 조립(`product-duplicate.ts`).
   둘 다 분기 100%
3. 목록 API (필터 · 검색 · 커서, 집계값 쿼리 1회)
4. Variant 목록 API (옵션 라벨 포함, 쿼리 1회)
5. 재고 조정 API — TASK-0036 의 `StockService.adjust` 위임
6. 일괄 상태 변경 API (한 트랜잭션, 검사 선행)
7. 상품 복제 API (TASK-0113 의 `create` 재사용, 재고 0)
8. 소유권 · 판매자 상태 검사 연결
9. 실제 PostgreSQL 통합 테스트 — 동시 조정(음성 대조군 포함), 커서 정합성, N+1 쿼리 수 측정

## 6. 완료 기준 (Definition of Done)

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 소유 필터 | 다른 판매자 상품을 포함한 DB 에서 목록 조회 | 자기 상품만 반환, 남의 id 직접 조회 시 403 | [ ] |
| F2 | 재고 조정 | `+5` 입고 요청 | `stock` 5 증가 **그리고** `StockLedger` 1행 생성 | [ ] |
| F3 | 동시성 | 조정 1건과 판매 3건을 동시 실행 | 최종 재고 = 원장 합계, 음수 0건 (A7) | [ ] |
| F4 | 재고 필터 | 품절 필터 · 품절 임박 필터 적용 | 각각 총재고 0 상품, 총재고 1~`LOW_STOCK_THRESHOLD` 상품만. 두 결과가 겹치지 않고, 배지(`isLowStock`)가 필터와 같은 술어를 쓴다 | [ ] |
| F5 | 일괄 상태 변경 | 5개 id 로 판매중지 요청 | 5건 전부 반영, 남의 상품 id 를 섞으면 403 (부분 적용 없음) | [ ] |
| F6 | 페이지네이션 | 100건에서 커서로 끝까지 순회 | 중복 0건 · 누락 0건 | [ ] |
| F7 | 복제 | 옵션 2종 상품 복제 | 옵션 · Variant 동수 복제, 상태 `DRAFT`, 재고 0, 원장 0행 | [ ] |
| F8 | 원장 우회 금지 | 코드 검색 | `product_variant.stock` 을 직접 `UPDATE` 하는 경로 0건 | [ ] |
| F9 | 이력 조회 | 초기 재고 0 인 Variant 에 조정 3회 후 `GET /variants/:id/ledger` | 3행 + 각 행의 `balanceAfter` 가 순서대로 일치, `seq` 가 1..3 | [ ] |
| F10 | 판매자 상태 | `SUSPENDED` 판매자로 재고 조정 | 403, 목록 조회는 200 | [ ] |

### 6.2 품질 게이트

[공통 품질 게이트](../QUALITY-GATES.md) 적용. 이 TASK 는 **엔드포인트를 추가하는 백엔드 TASK** 이므로
1장 · 3장 · 5장(C1·C3) · 7장을 받는다.

| 장 | 적용 | 비고 |
| --- | --- | --- |
| 1장 코드 게이트 | Q1~Q4 · Q6 · Q7 전부 | |
| Q5 테스트 충실도 | **라인 커버리지 80%**(M05 부터). 품절 임박 판정 · 집계 계산은 순수 로직이므로 **분기 100%**(Q5 강화) | 대역: **실제 PostgreSQL** |
| **2장 화면 게이트** | **해당 없음** | 사용자 대상 화면이 없다. 화면은 TASK-0116 |
| 3장 API 게이트 | A1~A7 전부. **A5 · A7 이 이 TASK 의 핵심** | A5 = 목록 N+1, A7 = 동시 재고 조정 |
| **4장 데이터 게이트** | **해당 없음** | `schema.prisma` 무변경 |
| 5장 계약 게이트 | **C1 · C3** | C2 는 TASK-0116 |
| 7장 문서 게이트 | D1~D5 | |

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| A1 | 응답 시간 | 상품 100건 목록 p95 | 300ms 이하 | [ ] |
| A2 | 입력 검증 | `delta: 0` · 알 수 없는 상태값 | 400 + 통일된 에러 포맷 | [ ] |
| A3 | 권한 | `BUYER` 토큰으로 재고 조정 호출 | 403 | [ ] |
| A4 | 인증 | 토큰 없이 호출 | 401 | [ ] |
| A5 | N+1 | 상품 100건 목록의 쿼리 로그 | 상품 수와 무관하게 쿼리 수 일정 | [ ] |
| A6 | 실 DB | 서비스·API 테스트 실행 대상 | Prisma 모킹 0건, 실제 PostgreSQL | [ ] |
| A7 | 동시 요청 | F3 | 초과 차감 · 중복 처리 0건 | [ ] |
| C1 | 스키마 단일 출처 | 응답 DTO 출처 확인 | 전부 `packages/shared` 의 zod 스키마 | [ ] |
| C3 | 실제 응답 검증 | 통합 테스트에서 실제 응답을 `sellerProductListResponseSchema` 등으로 `parse` | 전부 통과 | [ ] |

### 6.3 문서

| # | 기준 | 충족 |
| --- | --- | --- |
| D1 | 상태를 `완료` 로 변경. **두 인덱스(`docs/tasks/README.md` · `M05-catalog/README.md`)는 오케스트레이터가 갱신한다** — `main` 에서 계속 움직이는 파일이라 작업자가 건드리면 매번 충돌한다(CLAUDE.md 2장) | [ ] |
| D2 | 품절 임박 기준(`LOW_STOCK_THRESHOLD`)을 `docs/design/erd.md` 3장 또는 `pages.md` 판매자 절에 명시 | [ ] |
| D3 | 결정 변경 없음 확인 | [ ] |
| D4 | 새 환경변수 없음 확인 | [ ] |
| D5 | 새 라이브러리 없음 확인 (8장) | [ ] |

## 7. 리스크 / 열린 질문

| # | 내용 | 대응 |
| --- | --- | --- |
| R1 | 목록에서 Variant 를 모두 로드해 N+1 이 난다 | 목록은 **집계값(총재고 · 최저가)만** 반환하고 Variant 는 상세 엔드포인트로 분리한다(A5) |
| R2 | 재고를 직접 `UPDATE` 하는 우회 경로가 생긴다 | 조정은 TASK-0036 의 `adjustStock` 한 곳만 호출한다. F8 이 코드 검색으로 고정한다 |
| R3 | 품절 임박 기준값 5 가 카테고리마다 부적절할 수 있다 | 상수 하나로 시작한다. 카테고리별 기준이 필요해지면 그때 설정값으로 승격하고, 상수를 읽던 두 곳(API · 화면)만 바꾸면 된다 |
| R4 | 일괄 상태 변경에 남의 상품 id 가 섞이면 부분 적용된다 | 소유권 검사를 **먼저 전부** 수행하고 하나라도 실패하면 403 으로 끝낸다(F5) |
| R5 | 복제된 상품의 SKU 가 중복된다 | 복제 시 SKU 에 접미사를 붙이거나 비운다. 규칙을 `productWriteRequestSchema` 의 SKU 제약과 맞춘다 |

## 8. 확정된 버전

새 의존성 없음.

## 9. 변경 이력

| 날짜 | 내용 |
| --- | --- |
| 2026-09-03 | 최초 작성. D-208 에 따라 TASK-0035 에서 분할 |
| 2026-09-05 | 착수 시 정정. 승인본이 2026-09-03 작성분이라 그 뒤 머지된 TASK-0036 · 0113 의 실물과 어긋난 곳을 코드보다 먼저 고쳤다 — ① 재고 이력 조회는 이미 있다(만들지 않고 재사용) ② `variantStockSchema` 는 이미 다른 뜻으로 쓰여 `sellerVariantSchema` 로 ③ `stockLedgerEntrySchema` 는 TASK-0036 소유라 신규 목록에서 뺐다 ④ 원장에 전역 id 가 없어 `ledgerId` → `seq` ⑤ `adjustStock` 이라는 함수명은 없다(`StockService.adjust`). 더해 설계를 셋 못박았다 — 품절/품절 임박 술어를 겹치지 않게 세 단계로, 조정 `type` 을 `INBOUND`·`ADJUST` 로, 판매자 상태는 `assertSellerActive` 대신 TASK-0113 과 같은 코드 있는 403 으로 |
