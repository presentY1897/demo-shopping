/**
 * 수수료율 대역이 답하는 값들.
 *
 * **전부 계약 스키마를 지난다.** `@shopping/api-mocks` 의 `defineFixture` 가 모든
 * 응답에 하는 일과 같은 것이고, 같은 이유로 있다: 검사가 지어낸 모양은 서버가
 * 실제로 보내는 모양이 아닐 수 있고, 그러면 화면은 오지 않는 값을 그리는 코드로
 * 통과한다 (게이트 C2).
 *
 * **`packages/api-mocks` 에 msw 대역이 없다.** `/commission-rates` 세 라우트는 그
 * 패키지에 아직 등록되어 있지 않고, 이 TASK 는 `apps/admin` 밖을 고치지 않는다.
 * 그래서 이 화면의 검사는 `lib/commissions/console-api` 를 대신 세운다 — 경로와
 * 스키마가 한 곳에 모여 있는 것이 그것을 가능하게 한다. 대역이 그 패키지에 들어오면
 * 다른 화면들처럼 `server.use(...)` 로 옮겨 간다.
 */

import type {
  CommissionRate,
  CommissionRateListResponse,
  CommissionSimulationResponse,
} from '@shopping/shared'
import {
  commissionRateListResponseSchema,
  commissionRateSchema,
  commissionSimulationResponseSchema,
} from '@shopping/shared'

/** 기본 요율 — `DEFAULT_COMMISSION_RATE_BP` 와 같은 값으로 둔다 (3%). */
export const FALLBACK_RATE_BP = 300

export const CHANGED_BY = { id: '019596e0-0009-7000-8000-000000000001', email: 'super@demo.test' }

/** 목록에 없는 스토어. 이름을 못 찾는 갈래가 실제로 일어나는 자리다. */
export const UNKNOWN_SELLER_ID = '019596e0-0aaa-7000-8000-0000000000ff'

let serial = 0

export function commissionRate(overrides: Partial<CommissionRate> = {}): CommissionRate {
  serial += 1

  return commissionRateSchema.parse({
    id: `019596e0-0007-7000-8000-${String(serial).padStart(12, '0')}`,
    sellerId: null,
    categoryId: null,
    scope: 'global',
    rateBp: 300,
    validFrom: '2026-09-01T00:00:00.000Z',
    validUntil: null,
    createdBy: CHANGED_BY,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  })
}

export function rateList(
  rates: readonly CommissionRate[],
  fallbackRateBp: number = FALLBACK_RATE_BP,
): CommissionRateListResponse {
  return commissionRateListResponseSchema.parse({ rates, fallbackRateBp })
}

export function simulation(
  overrides: Partial<CommissionSimulationResponse> = {},
): CommissionSimulationResponse {
  return commissionSimulationResponseSchema.parse({
    salesAmount: 12_000_000,
    currentAmount: 360_000,
    proposedAmount: 420_000,
    sellerOrderCount: 42,
    ...overrides,
  })
}
