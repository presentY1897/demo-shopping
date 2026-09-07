/**
 * 전체 상품·주문 대역이 답하는 값들.
 *
 * **전부 계약 스키마를 지난다.** `@shopping/api-mocks` 의 `defineFixture` 가 모든
 * 응답에 하는 일과 같은 것이고, 같은 이유로 있다: 검사가 지어낸 모양은 서버가 실제로
 * 보내는 모양이 아닐 수 있고, 그러면 화면은 오지 않는 값을 그리는 코드로 통과한다
 * (게이트 C2). 주문의 줄에 가려지지 않은 이름이 없다는 것도 여기서 지켜진다 — 계약이
 * `maskedBuyerName` 만 싣기 때문에 원본을 넣으려 하면 스키마가 그것을 떨어뜨린다.
 *
 * **`packages/api-mocks` 에 이 라우트들의 대역이 없다.** `GET /products` 는 그 패키지가
 * 쓰기만 재현하고 목록 핸들러가 없으며(`handlers/products.ts`), `/admin/orders` 와
 * `/admin/products/:id/hidden` 은 등록되어 있지 않다. 이 TASK 는 `apps/admin` 밖을
 * 고치지 않으므로 `lib/catalog/console-api` 를 대신 세운다 — 경로와 스키마가 그 한
 * 파일에 모여 있는 것이 그것을 가능하게 한다 (`support/users.ts` 와 같은 사정).
 */

import type {
  AdminOrderPayment,
  AdminOrderPaymentsResponse,
  AdminOrderRow,
  AdminOrderSearchResponse,
  CategoryTreeResponse,
  ProductListResponse,
  ProductModerationResponse,
  ProductSummary,
} from '@shopping/shared'
import {
  adminOrderPaymentSchema,
  adminOrderPaymentsResponseSchema,
  adminOrderRowSchema,
  adminOrderSearchResponseSchema,
  categoryTreeResponseSchema,
  productListResponseSchema,
  productModerationResponseSchema,
  productSummarySchema,
} from '@shopping/shared'

let serial = 0

function nextId(prefix: string): string {
  serial += 1

  return `019596e0-${prefix}-7000-8000-${String(serial).padStart(12, '0')}`
}

/** 검사가 고정해 두는 스토어 하나. 목록의 이름 표와 상품의 `sellerId` 가 이것으로 만난다. */
export const CATALOG_SELLER_ID = '019596e0-0061-7000-8000-0000000000aa'

/**
 * 「여성 › 아우터 › 코트」의 id.
 *
 * `@shopping/api-mocks` 의 카테고리 대역이 깊이 우선으로 번호를 매기므로 3이 그
 * 자리다 (`fixtures/categories.ts`). 그 대역을 그대로 쓰는 화면 검사에서 id 가 이름으로
 * 바뀌는 것을 실제로 확인할 수 있어야 한다.
 */
export const CATALOG_CATEGORY_ID = 3

/** 목록의 한 줄. 기본값은 판매 중인 상품 — 곧 **내릴 수 있는** 상품이다. */
export function productRow(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return productSummarySchema.parse({
    id: nextId('0071'),
    sellerId: CATALOG_SELLER_ID,
    categoryId: CATALOG_CATEGORY_ID,
    name: '캐시미어 블렌드 코트',
    status: 'ACTIVE',
    minPrice: 189_000,
    ratingAvg: 450,
    ratingCount: 12,
    salesCount: 34,
    variantCount: 6,
    stock: 21,
    thumbnailUrl: null,
    // 강제로 내려진 상품만 이 둘을 든다. 신고를 통해 내려진 것은 비어 있다 —
    // 그쪽 근거는 신고 행이 갖고 있다.
    moderatedAt: null,
    moderationReason: null,
    version: 3,
    ...overrides,
  })
}

export function productList(
  products: readonly ProductSummary[],
  overrides: Partial<ProductListResponse> = {},
): ProductListResponse {
  return productListResponseSchema.parse({ products, nextCursor: null, ...overrides })
}

/** 강제 숨김·해제의 답. 싣는 것은 **숨김 여부와 그 근거**뿐이다. */
export function moderated(
  product: ProductSummary,
  hidden: boolean,
  reason: string | null = null,
): ProductModerationResponse {
  return productModerationResponseSchema.parse({
    product: {
      productId: product.id,
      hidden,
      moderatedAt: hidden ? '2026-09-07T00:00:00.000Z' : null,
      moderationReason: reason,
    },
  })
}

/** 카테고리 트리 두 층. 자식이 있어야 이름을 이어 붙이는 자리가 실제로 돈다. */
export function categoryTree(): CategoryTreeResponse {
  return categoryTreeResponseSchema.parse({
    nodes: [
      {
        id: 1,
        parentId: null,
        name: '여성',
        slug: 'women',
        depth: 1,
        path: '/1/',
        sortOrder: 0,
        isActive: true,
        productCount: 40,
        version: 1,
        children: [
          {
            id: CATALOG_CATEGORY_ID,
            parentId: 1,
            name: '아우터',
            slug: 'women-outer',
            depth: 2,
            path: `/1/${String(CATALOG_CATEGORY_ID)}/`,
            sortOrder: 0,
            isActive: true,
            productCount: 12,
            version: 1,
            children: [],
          },
        ],
      },
    ],
  })
}

/** 주문의 한 줄. 기본값은 **한 스토어짜리** 주문이다. */
export function orderRow(overrides: Partial<AdminOrderRow> = {}): AdminOrderRow {
  return adminOrderRowSchema.parse({
    orderId: nextId('0081'),
    orderNumber: '20260906-000123',
    maskedBuyerName: '홍*동',
    paidAmount: 189_000,
    createdAt: '2026-09-06T02:00:00.000Z',
    sellerOrders: [
      {
        sellerOrderId: nextId('0082'),
        sellerId: CATALOG_SELLER_ID,
        brandName: '루미에르',
        status: 'PAID',
        paidAmount: 189_000,
      },
    ],
    ...overrides,
  })
}

/** 두 스토어로 갈린 주문 (F5). 하나만 그리면 절반이 화면에서 사라진다. */
export function splitOrderRow(): AdminOrderRow {
  return orderRow({
    orderNumber: '20260906-000999',
    paidAmount: 289_000,
    sellerOrders: [
      {
        sellerOrderId: nextId('0082'),
        sellerId: CATALOG_SELLER_ID,
        brandName: '루미에르',
        status: 'PAID',
        paidAmount: 189_000,
      },
      {
        sellerOrderId: nextId('0082'),
        sellerId: '019596e0-0061-7000-8000-0000000000bb',
        brandName: '아틀리에',
        status: 'SHIPPED',
        paidAmount: 100_000,
      },
    ],
  })
}

export function orderList(
  orders: readonly AdminOrderRow[],
  overrides: Partial<AdminOrderSearchResponse> = {},
): AdminOrderSearchResponse {
  return adminOrderSearchResponseSchema.parse({ orders, nextCursor: null, ...overrides })
}

export function orderPayment(overrides: Partial<AdminOrderPayment> = {}): AdminOrderPayment {
  return adminOrderPaymentSchema.parse({
    paymentId: nextId('0083'),
    provider: 'TOSS',
    status: 'PAID',
    amount: 189_000,
    canceledAmount: 0,
    approvedAt: '2026-09-06T02:00:10.000Z',
    createdAt: '2026-09-06T02:00:00.000Z',
    ...overrides,
  })
}

export function orderPayments(payments: readonly AdminOrderPayment[]): AdminOrderPaymentsResponse {
  return adminOrderPaymentsResponseSchema.parse({
    payments,
    // 취소된 몫의 합. 서버가 줄마다 더해 답하므로 여기서도 같은 식으로 만든다.
    refundedAmount: payments.reduce((total, payment) => total + payment.canceledAmount, 0),
  })
}
