/**
 * 정산 대역이 답하는 값들.
 *
 * **전부 계약 스키마를 지난다.** `@shopping/api-mocks` 의 `defineFixture` 가 모든
 * 응답에 하는 일과 같은 것이고, 같은 이유로 있다: 검사가 지어낸 모양은 서버가
 * 실제로 보내는 모양이 아닐 수 있고, 그러면 화면은 오지 않는 값을 그리는 코드로
 * 통과한다 (게이트 C2). 지급액이 네 금액의 합이라는 것도 여기서 지켜진다 — DB 의
 * 검사 제약이 그 식을 강제하므로, 그것을 어긴 고정값은 서버가 만들 수 없는 값이다.
 *
 * **`packages/api-mocks` 에 msw 대역이 없다.** `/settlements` 라우트들은 그 패키지에
 * 아직 등록되어 있지 않고, 이 TASK 는 `apps/admin` 밖을 고치지 않는다. 그래서 이
 * 화면의 검사는 `lib/settlements/console-api` 를 대신 세운다 — 경로와 스키마가 한
 * 곳에 모여 있는 것이 그것을 가능하게 한다 (`support/commissions.ts` 와 같은 사정).
 */

import type {
  BulkApproveSettlementsResponse,
  Settlement,
  SettlementDetailResponse,
  SettlementItem,
  SettlementListResponse,
} from '@shopping/shared'
import {
  bulkApproveSettlementsResponseSchema,
  settlementDetailResponseSchema,
  settlementItemSchema,
  settlementListResponseSchema,
  settlementSchema,
} from '@shopping/shared'

/** 2026-08-24(월) 00:00 KST 에 시작해 2026-08-31(월) 00:00 KST 에 닫히는 회차. */
export const PERIOD_START = '2026-08-23T15:00:00.000Z'

export const PERIOD_END = '2026-08-30T15:00:00.000Z'

export const SELLER_ID = '019596e0-0011-7000-8000-000000000001'

let serial = 0

/**
 * 정산서 한 장.
 *
 * 기본값은 TASK-0081 4장이 그린 바로 그 숫자다 — 판매액 1,890,000 · 수수료
 * 189,000 · 판매자 쿠폰 30,000 · 반품 차감 -120,000 · 지급액 1,551,000.
 */
export function settlement(overrides: Partial<Settlement> = {}): Settlement {
  serial += 1

  return settlementSchema.parse({
    id: `019596e0-0012-7000-8000-${String(serial).padStart(12, '0')}`,
    sellerId: SELLER_ID,
    brandName: '루미에르',
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    status: 'PENDING',
    salesAmount: 1_890_000,
    commissionAmount: 189_000,
    sellerCouponAmount: 30_000,
    returnAdjustmentAmount: -120_000,
    payoutAmount: 1_551_000,
    holdReason: null,
    heldAt: null,
    approvedAt: null,
    paidAt: null,
    createdAt: '2026-08-31T00:10:00.000Z',
    ...overrides,
  })
}

/** 정산서의 한 줄. 차감 줄에서는 **셋 다 음수**여야 합계가 그냥 합이 된다. */
export function settlementItem(overrides: Partial<SettlementItem> = {}): SettlementItem {
  serial += 1

  return settlementItemSchema.parse({
    id: `019596e0-0013-7000-8000-${String(serial).padStart(12, '0')}`,
    type: 'SALE',
    sellerOrderId: `019596e0-0014-7000-8000-${String(serial).padStart(12, '0')}`,
    orderNumber: `20260824-00${String(serial % 10)}`,
    salesAmount: 1_890_000,
    commissionAmount: 189_000,
    sellerCouponAmount: 30_000,
    payoutAmount: 1_671_000,
    createdAt: '2026-08-31T00:10:00.000Z',
    ...overrides,
  })
}

export function settlementList(
  settlements: readonly Settlement[],
  overrides: Partial<SettlementListResponse> = {},
): SettlementListResponse {
  return settlementListResponseSchema.parse({
    settlements,
    nextCursor: null,
    totals: {
      count: settlements.length,
      payoutAmount: settlements.reduce((sum, row) => sum + row.payoutAmount, 0),
    },
    ...overrides,
  })
}

export function settlementDetail(
  row: Settlement,
  items: readonly SettlementItem[] = [],
): SettlementDetailResponse {
  return settlementDetailResponseSchema.parse({ settlement: row, items })
}

export function bulkApproval(
  approved: readonly string[],
  failed: readonly { id: string; reason: 'not_found' | 'wrong_status' }[] = [],
): BulkApproveSettlementsResponse {
  return bulkApproveSettlementsResponseSchema.parse({ approved, failed })
}
