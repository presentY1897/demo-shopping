/**
 * 스토어 대역이 답하는 값들.
 *
 * **전부 계약 스키마를 지난다.** `@shopping/api-mocks` 의 `defineFixture` 가 모든
 * 응답에 하는 일과 같은 것이고, 같은 이유로 있다: 검사가 지어낸 모양은 서버가 실제로
 * 보내는 모양이 아닐 수 있고, 그러면 화면은 오지 않는 값을 그리는 코드로 통과한다
 * (게이트 C2). 클레임률이 `null` 일 수 있다는 것도 여기서 지켜진다 — 그것이 이 화면의
 * 판단 하나를 통째로 좌우한다 (TASK-0094 4.5).
 *
 * **`packages/api-mocks` 에 msw 대역이 없다.** `/admin/stores` 두 라우트는 그 패키지에
 * 아직 등록되어 있지 않고(`mockPaths` 에 항목이 없다), 이 TASK 는 `apps/admin` 밖을
 * 고치지 않는다. 그래서 이 화면의 검사는 `lib/stores/console-api` 를 대신 세운다 —
 * 경로와 스키마가 그 한 파일에 모여 있는 것이 그것을 가능하게 한다
 * (`support/users.ts` 와 같은 사정).
 */

import type {
  AdminSellerListResponse,
  AdminSellerMetrics,
  AdminSellerRow,
  SellerStatusEvent,
  SellerStatusHistoryResponse,
} from '@shopping/shared'
import {
  adminSellerListResponseSchema,
  adminSellerRowSchema,
  sellerStatusEventSchema,
  sellerStatusHistoryResponseSchema,
} from '@shopping/shared'

let serial = 0

function nextId(prefix: string): string {
  serial += 1

  return `019596e0-${prefix}-7000-8000-${String(serial).padStart(12, '0')}`
}

/** 지표 한 벌. 기본값은 **실제로 판 적이 있는** 스토어다. */
export function storeMetrics(overrides: Partial<AdminSellerMetrics> = {}): AdminSellerMetrics {
  return {
    salesAmount: 1_890_000,
    orderCount: 40,
    claimCount: 2,
    // 5% — 2 / 40. 정수 100배이므로 500 이다.
    claimRateBp: 500,
    // 4.2점.
    ratingAvg: 420,
    ratingCount: 31,
    productCount: 12,
    ...overrides,
  }
}

/** 아직 한 건도 팔지 않은 스토어의 지표. `claimRateBp` 가 **`null`** 이다 (4.5). */
export const untradedMetrics: AdminSellerMetrics = storeMetrics({
  salesAmount: 0,
  orderCount: 0,
  claimCount: 0,
  claimRateBp: null,
  ratingAvg: 0,
  ratingCount: 0,
  productCount: 1,
})

/** 목록의 한 줄. 기본값은 영업 중인 실계정 스토어다. */
export function storeRow(overrides: Partial<AdminSellerRow> = {}): AdminSellerRow {
  return adminSellerRowSchema.parse({
    sellerId: nextId('0061'),
    brandName: '루미에르',
    status: 'ACTIVE',
    isDemo: false,
    followerCount: 128,
    createdAt: '2026-05-01T00:00:00.000Z',
    metrics: storeMetrics(),
    ...overrides,
  })
}

export function storeList(
  sellers: readonly AdminSellerRow[],
  overrides: Partial<AdminSellerListResponse> = {},
): AdminSellerListResponse {
  return adminSellerListResponseSchema.parse({ sellers, nextCursor: null, ...overrides })
}

/** 이력 한 줄. 기본값은 사람이 내린 정지다. */
export function statusEvent(overrides: Partial<SellerStatusEvent> = {}): SellerStatusEvent {
  return sellerStatusEventSchema.parse({
    id: nextId('0062'),
    fromStatus: 'ACTIVE',
    toStatus: 'SUSPENDED',
    reason: '배송 지연 신고가 반복되어 정지했습니다.',
    actorId: '019596e0-0009-7000-8000-000000000001',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  })
}

export function statusHistory(events: readonly SellerStatusEvent[]): SellerStatusHistoryResponse {
  return sellerStatusHistoryResponseSchema.parse({ events })
}
