/**
 * The answers TASK-0082's three routes give, built through their contracts.
 *
 * `defineFixture` parses at module load, so a fixture that drifts from
 * `@shopping/shared` takes down every spec that imports it — including the
 * screen specs, which never mention the schema themselves (gate C2). Types alone
 * would not do: `returnAdjustmentAmount: 120_000` typechecks and fails
 * `settlementSchema`, whose `z.int().max(0)` is the whole reason that field can
 * be added to the other four.
 *
 * These live here rather than in `@shopping/api-mocks` only because this branch
 * does not own `packages/` — see `support/api-stub.ts`.
 */

import { defineFixture, sessionSellerOwner } from '@shopping/api-mocks'
import type {
  SellerRevenueResponse,
  Settlement,
  SettlementDetailResponse,
  SettlementListResponse,
  SettlementOutlookResponse,
} from '@shopping/shared'
import {
  sellerRevenueResponseSchema,
  settlementDetailResponseSchema,
  settlementListResponseSchema,
  settlementOutlookResponseSchema,
} from '@shopping/shared'

/** The store the signed-in seller owns. Read off the session, never retyped. */
export const MOCK_SELLER_ID = sessionSellerOwner.user.sellerId ?? ''

/** 30일. F5 가 재는 것과 같은 크기다. */
export const REVENUE_DAYS = 30

export const REVENUE_FROM = '2026-08-08'

export const REVENUE_TO = '2026-09-06'

/**
 * 하루치 칸 서른 개.
 *
 * 손으로 적지 않는다 — 서른 줄을 붙여 넣으면 그중 하나가 틀려도 아무도 못 본다.
 * 대신 **모양이 다른 날 셋**을 심는다: 아무것도 못 판 날, 가장 많이 판 날, 그리고
 * 나머지. 차트의 세 경계(0으로 나누기 · 꼭대기 · 보통)가 그 셋에 걸린다.
 */
const days = Array.from({ length: REVENUE_DAYS }, (_, index) => {
  const date = new Date(Date.parse(`${REVENUE_FROM}T00:00:00.000Z`) + index * 86_400_000)
    .toISOString()
    .slice(0, 10)

  if (index === 0) return { date, orderCount: 0, salesAmount: 0 }
  if (index === REVENUE_DAYS - 1) return { date, orderCount: 9, salesAmount: 900_000 }

  return { date, orderCount: index % 4, salesAmount: index * 10_000 }
})

const salesAmount = days.reduce((sum, entry) => sum + entry.salesAmount, 0)

const orderCount = days.reduce((sum, entry) => sum + entry.orderCount, 0)

/** 30일치 매출 한 벌. 지난 기간이 **0이 아니므로** 증감률이 그려진다. */
export const sellerRevenue: SellerRevenueResponse = defineFixture(sellerRevenueResponseSchema, {
  days,
  from: REVENUE_FROM,
  previous: { averageOrderAmount: 40_000, orderCount: 30, salesAmount: 1_200_000 },
  to: REVENUE_TO,
  topProducts: [
    {
      productId: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f2001',
      productName: '리네아 오버사이즈 코트',
      quantity: 12,
      salesAmount: 1_440_000,
    },
    {
      productId: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f2002',
      productName: '메르시아 니트 카디건',
      quantity: 8,
      salesAmount: 560_000,
    },
  ],
  totals: {
    averageOrderAmount: orderCount === 0 ? 0 : Math.round(salesAmount / orderCount),
    orderCount,
    salesAmount,
  },
})

/** 지난 기간에 아무것도 못 판 판매자. **증감률이 없는** 쪽이다 (F6). */
export const sellerRevenueWithoutPrevious: SellerRevenueResponse = defineFixture(
  sellerRevenueResponseSchema,
  {
    ...sellerRevenue,
    previous: { averageOrderAmount: 0, orderCount: 0, salesAmount: 0 },
  },
)

export const settlementOutlook: SettlementOutlookResponse = defineFixture(
  settlementOutlookResponseSchema,
  {
    awaitingConfirmation: { payoutAmount: 430_000, sellerOrderCount: 5 },
    awaitingSettlement: { payoutAmount: 180_000, sellerOrderCount: 2 },
  },
)

/** 지급된 회차 하나. 계산 근거의 네 항이 전부 0이 아니다. */
const paidSettlement = {
  approvedAt: '2026-09-01T02:00:00.000Z',
  brandName: '루미에르',
  commissionAmount: 189_000,
  createdAt: '2026-09-01T00:00:00.000Z',
  heldAt: null,
  holdReason: null,
  id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f3001',
  paidAt: '2026-09-02T02:00:00.000Z',
  payoutAmount: 1_551_000,
  periodEnd: '2026-08-31T15:00:00.000Z',
  periodStart: '2026-08-24T15:00:00.000Z',
  returnAdjustmentAmount: -120_000,
  salesAmount: 1_890_000,
  sellerCouponAmount: 30_000,
  sellerId: MOCK_SELLER_ID,
  status: 'PAID',
} satisfies Settlement

/** 보류된 회차. 사유가 목록과 상세 양쪽에 그려진다. */
const heldSettlement = {
  ...paidSettlement,
  approvedAt: null,
  commissionAmount: 42_000,
  heldAt: '2026-09-01T03:00:00.000Z',
  holdReason: '반품 분쟁 확인 중',
  id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f3002',
  paidAt: null,
  payoutAmount: 378_000,
  periodEnd: '2026-09-07T15:00:00.000Z',
  periodStart: '2026-08-31T15:00:00.000Z',
  returnAdjustmentAmount: 0,
  salesAmount: 420_000,
  sellerCouponAmount: 0,
  status: 'HOLD',
} satisfies Settlement

export const PAID_SETTLEMENT_ID = paidSettlement.id

export const HELD_SETTLEMENT_ID = heldSettlement.id

/** 첫 페이지. `nextCursor` 가 있어 「다음」이 눌린다. */
export const settlementListPage1: SettlementListResponse = defineFixture(
  settlementListResponseSchema,
  {
    nextCursor: 'cursor-page-2',
    settlements: [heldSettlement, paidSettlement],
    totals: { count: 3, payoutAmount: 2_100_000 },
  },
)

/** 마지막 페이지. */
export const settlementListPage2: SettlementListResponse = defineFixture(
  settlementListResponseSchema,
  {
    nextCursor: null,
    settlements: [
      {
        ...paidSettlement,
        id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f3003',
        payoutAmount: 171_000,
        periodEnd: '2026-08-24T15:00:00.000Z',
        periodStart: '2026-08-17T15:00:00.000Z',
      },
    ],
    totals: { count: 3, payoutAmount: 2_100_000 },
  },
)

export const settlementListEmpty: SettlementListResponse = defineFixture(
  settlementListResponseSchema,
  { nextCursor: null, settlements: [], totals: { count: 0, payoutAmount: 0 } },
)

/**
 * 정산서 한 장과 항목 둘 — 판매 한 줄과 **차감 한 줄**.
 *
 * 차감 줄의 셋이 전부 음수인 것이 계약의 규약이고, 그래야 세로로 더한 값이 위의
 * 합계와 같아진다.
 */
export const settlementDetail: SettlementDetailResponse = defineFixture(
  settlementDetailResponseSchema,
  {
    items: [
      {
        commissionAmount: 189_000,
        createdAt: '2026-09-01T00:00:00.000Z',
        id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f4001',
        orderNumber: 'ORD-20260825-0001',
        payoutAmount: 1_671_000,
        salesAmount: 1_890_000,
        sellerCouponAmount: 30_000,
        sellerOrderId: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f5001',
        type: 'SALE',
      },
      {
        commissionAmount: -12_000,
        createdAt: '2026-09-01T00:00:00.000Z',
        id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f4002',
        orderNumber: 'ORD-20260818-0007',
        payoutAmount: -120_000,
        salesAmount: -132_000,
        sellerCouponAmount: 0,
        sellerOrderId: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f5002',
        type: 'RETURN_ADJUSTMENT',
      },
    ],
    settlement: paidSettlement,
  },
)
