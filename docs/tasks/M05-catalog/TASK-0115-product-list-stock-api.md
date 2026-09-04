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
- **Variant 재고 조정 API** — **조정량(delta) 입력**. TASK-0036 의 `adjustStock` 을 그대로 호출해
  `StockLedger` 에 기록
- **Variant 목록 · 재고 이력 조회 API** — 특정 상품의 Variant 별 현재 재고와 원장 이력
- **일괄 상태 변경 API** — 여러 상품을 판매중지 · 재개
- **상품 복제 API** — 옵션 · Variant 포함 복제, 결과는 `DRAFT`. 재고는 복제하지 않는다
- 소유권(`product.*:own`) · 판매자 상태(`assertSellerActive`) 검사
- 절단면이 되는 zod 스키마를 `packages/shared` 에 정의

### 제외 (이번에 하지 않는 것)
- **상품 목록 · 재고 관리 화면** → TASK-0116
- **재고 원장 자체(테이블 · `adjustStock` · 행 잠금)** → TASK-0036. 이 API 는 그것을 호출만 한다
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

| 메서드 · 경로 | 용도 | 퍼미션 |
| --- | --- | --- |
| `GET /api/v1/seller/products?status=&categoryId=&stock=&q=&cursor=` | 상품 목록 (집계값) | `product.read:own` |
| `GET /api/v1/seller/products/:id/variants` | Variant 목록 + 현재 재고 | `product.read:own` |
| ~~`GET /api/v1/seller/variants/:id/ledger`~~ → **`GET /api/v1/variants/:id/ledger`** | 재고 변동 이력 | `product.read:own` |
| `POST /api/v1/variants/:id/stock-adjustments` | 재고 조정 (조정량) | `product.write:own` |
| `POST /api/v1/seller/products/status` | 일괄 상태 변경 | `product.write:own` |
| `POST /api/v1/seller/products/:id/duplicate` | 상품 복제 | `product.write:own` |

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

요청 본문은 `{ delta, type, reason }` 이고, 서버는 그대로 `adjustStock` 에 넘긴다. **이 API 는 재고를
직접 쓰지 않는다** — 쓰는 순간 원장 합계와 현재 재고가 어긋날 수 있는 두 번째 경로가 생긴다.

### 목록은 집계값만

원본 TASK-0035 의 R1 이 지적한 그대로다 — 목록에서 Variant 를 전부 로드하면 N+1 이 된다.

| 목록이 주는 것 | 목록이 주지 않는 것 |
| --- | --- |
| 총재고(Variant 재고 합), 최저가, 품절 임박 플래그, 대표 이미지 1장, 상태 | Variant 개별 행, 옵션 조합, 전체 이미지 |

Variant 는 `GET /seller/products/:id/variants` 로 따로 가져간다.

### 품절 임박 기준

```ts
// packages/shared
export const LOW_STOCK_THRESHOLD = 5
```

원본 TASK-0035 는 "품절 임박 기준 정의 및 표시"를 구현 계획에만 남기고 값을 정하지 않았다. 값을 정하지
않으면 **필터의 기준과 배지의 기준이 갈린다.** 상수 하나를 절단면에 두고 API 필터와 화면 배지가 같은
값을 읽는다.

### 복제

옵션 · Variant · 이미지 · 속성값을 복제하고 **재고는 0 으로 시작**한다. 재고를 복제하면 원장 없이
재고가 생겨 원장 합계와 어긋난다. 결과 상품은 `DRAFT` 이므로 판매되지 않는다.

### 절단면 — `packages/shared` 의 zod 스키마

이 TASK 가 **정의**하고 그대로 응답한다. TASK-0116 이 **같은 스키마로 모킹 데이터를 만든다.**

| 스키마 | 내용 | 쓰는 곳 |
| --- | --- | --- |
| `sellerProductListQuerySchema` | 목록 질의 (status, categoryId, stock, q, cursor, limit) | 0115 · 0116 |
| `sellerProductListItemSchema` | 목록 1행 (id, name, status, totalStock, minPrice, isLowStock, thumbnailUrl) | 0115 · 0116 |
| `sellerProductListResponseSchema` | `{ items, nextCursor }` | 0115 · 0116 |
| `variantStockSchema` | Variant 1건 (id, sku, optionLabel, stock, maxPurchaseQuantity, isActive) | 0115 · 0116 |
| `stockAdjustRequestSchema` | `{ delta, type, reason }` — **delta 는 0이 아닌 정수** | 0115 · 0116 |
| `stockAdjustResponseSchema` | `{ variantId, delta, balanceAfter, ledgerId }` | 0115 · 0116 |
| `stockLedgerEntrySchema` | 이력 1행 (type, quantity, balanceAfter, reason, createdAt) | 0115 · 0116 |
| `productBulkStatusRequestSchema` | `{ productIds, status }` | 0115 · 0116 |
| `LOW_STOCK_THRESHOLD` | 품절 임박 기준 상수 | 0115 · 0116 |

`productStatusSchema` 는 TASK-0113 이 정의한 것을 그대로 쓴다.

### 역할별 권한

| 역할 | 할 수 있는 것 |
| --- | --- |
| 판매자(SELLER_OWNER, `ACTIVE`) | 자기 상품 목록 · Variant · 이력 조회, 재고 조정, 일괄 상태 변경, 복제 |
| 판매자(그 외 상태) | 조회만. 쓰기는 403 (`assertSellerActive`) |
| 구매자(BUYER) | 없음 — 403 |
| 관리자 | `/seller/` 경로가 아니다. 전체 상품 조회는 M14(TASK-0095) |

## 5. 구현 계획

1. `packages/shared` 에 절단면 스키마 8종 + 상수 정의, `index.ts` export
2. 목록 API (필터 · 검색 · 커서, 집계값 쿼리 1회)
3. Variant 목록 · 원장 이력 조회 API
4. 재고 조정 API — TASK-0036 의 `adjustStock` 위임
5. 일괄 상태 변경 API
6. 상품 복제 API (TASK-0113 의 쓰기 경로 재사용, 재고 0)
7. 소유권 · 판매자 상태 검사 연결
8. 실제 PostgreSQL 통합 테스트 — 동시 조정, 커서 정합성, N+1 쿼리 수 측정

## 6. 완료 기준 (Definition of Done)

### 6.1 기능

| # | 기준 | 측정 방법 | 목표 | 충족 |
| --- | --- | --- | --- | --- |
| F1 | 소유 필터 | 다른 판매자 상품을 포함한 DB 에서 목록 조회 | 자기 상품만 반환, 남의 id 직접 조회 시 403 | [ ] |
| F2 | 재고 조정 | `+5` 입고 요청 | `stock` 5 증가 **그리고** `StockLedger` 1행 생성 | [ ] |
| F3 | 동시성 | 조정 1건과 판매 3건을 동시 실행 | 최종 재고 = 원장 합계, 음수 0건 (A7) | [ ] |
| F4 | 재고 필터 | 품절 필터 · 품절 임박 필터 적용 | 각각 재고 0 상품, 가용재고 ≤ `LOW_STOCK_THRESHOLD` 상품만 | [ ] |
| F5 | 일괄 상태 변경 | 5개 id 로 판매중지 요청 | 5건 전부 반영, 남의 상품 id 를 섞으면 403 (부분 적용 없음) | [ ] |
| F6 | 페이지네이션 | 100건에서 커서로 끝까지 순회 | 중복 0건 · 누락 0건 | [ ] |
| F7 | 복제 | 옵션 2종 상품 복제 | 옵션 · Variant 동수 복제, 상태 `DRAFT`, 재고 0, 원장 0행 | [ ] |
| F8 | 원장 우회 금지 | 코드 검색 | `product_variant.stock` 을 직접 `UPDATE` 하는 경로 0건 | [ ] |
| F9 | 이력 조회 | 조정 3회 후 이력 조회 | 3행 + 각 행의 `balanceAfter` 가 순서대로 일치 | [ ] |
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
| D1 | 상태를 `완료` 로 변경 + `docs/tasks/README.md` · `M05-catalog/README.md` 인덱스 갱신 | [ ] |
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
