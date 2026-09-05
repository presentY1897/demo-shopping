import type { OrderStatus, SellerOrderAction } from '@shopping/shared'

/**
 * 주문 대역이 픽스처와 핸들러 **양쪽에서** 읽는 것들 (TASK-0063).
 *
 * 픽스처 파일은 픽스처 말고 아무것도 내보낼 수 없으므로(`registry.spec.ts`), 두
 * 곳이 함께 쓰는 값은 여기 산다 — `card-contract.ts` 가 같은 이유로 있고, 그 파일이
 * 그 이유를 길게 적어 두었다.
 *
 * `card-contract.ts` 와 **다른 점 하나**: 저쪽은 계약이 `@shopping/shared` 에 없어서
 * 스키마를 한 벌 적었지만, 주문은 계약이 이미 전부 있다(`api/orders.ts` ·
 * `api/shipments.ts`). 그래서 여기 있는 것은 스키마가 아니라 **id 와 시각**, 그리고
 * 아래의 액션 표뿐이다.
 */

/**
 * 이 픽스처들이 「지금」이라고 부르는 시각.
 *
 * 기간 필터를 화면이 하므로(서버 계약에 기간이 없다) 그 필터를 검사하려면 **경계
 * 양쪽에 주문이 있어야** 한다. 픽스처의 다섯 건은 이 시각을 기준으로 1일 · 9일 ·
 * 83일 · 188일 · 514일 전에 흩어져 있고, 검사는
 * `vi.setSystemTime(new Date(MOCK_ORDER_NOW))` 으로 여기에 시계를 맞춘다.
 *
 * 「지금 + n일」을 계산해 픽스처를 만들지 않는 것은 `fixtures/checkout.ts` 의
 * `expiresAt` 과 같은 이유다 — 값이 고정돼 있어야 경계를 원하는 쪽으로 정확히
 * 고를 수 있다.
 */
export const MOCK_ORDER_NOW = '2026-09-06T00:00:00.000Z'

/** 대역이 상세로 답할 수 있는 주문들. 검사가 이 id 로 라우팅한다. */
export const MOCK_ORDER_IDS = {
  /** 판매자 셋, 상태 셋. 이 TASK 가 존재하는 이유가 이 주문이다. */
  mixed: '019596d0-1f1c-7c2e-9a0e-6a0000000001',
  confirmed: '019596d0-1f1c-7c2e-9a0e-6a0000000002',
  canceled: '019596d0-1f1c-7c2e-9a0e-6a0000000003',
  /** 지금은 카탈로그에 없는 상품이 들어 있다 (F4). */
  deleted: '019596d0-1f1c-7c2e-9a0e-6a0000000004',
  /** 목록 둘째 장에만 있다. 어떤 기간 필터에도 안 걸린다. */
  ancient: '019596d0-1f1c-7c2e-9a0e-6a0000000005',
} as const

/** 묶음 하나하나의 id. 액션·전이 라우트가 이것으로 온다. */
export const MOCK_SELLER_ORDER_IDS = {
  mixedDelivered: '019596d0-1f1c-7c2e-9a0e-6d0000000001',
  mixedShipped: '019596d0-1f1c-7c2e-9a0e-6d0000000002',
  mixedPreparing: '019596d0-1f1c-7c2e-9a0e-6d0000000003',
  confirmed: '019596d0-1f1c-7c2e-9a0e-6d0000000004',
  canceled: '019596d0-1f1c-7c2e-9a0e-6d0000000005',
  deleted: '019596d0-1f1c-7c2e-9a0e-6d0000000006',
} as const

/**
 * 구매자에게 열려 있는 전이 — **하나뿐**이다.
 *
 * `apps/api/src/orders/seller-order-transitions.ts` 의 표에서 `actors` 가 `BUYER`
 * 를 포함하는 줄을 뽑으면 `DELIVERED → CONFIRMED` 하나가 남는다. 취소·반품은
 * 클레임 절차의 **결론**이라 주체가 판매자·관리자이고, 결제로 움직이는 둘은
 * `SYSTEM` 이다.
 *
 * **표를 여기 한 벌 더 적는 것이 아니다.** 대역이 답해야 하는 것은 「구매자가
 * 지금 무엇을 누를 수 있나」이고, 그 답은 이 한 줄이 전부다. 상태 머신 전체를
 * 흉내 내면 QUALITY-GATES 6장 이 금지하는 「더 약한 두 번째 구현」이 된다 —
 * 실제 규칙은 실 PostgreSQL 에 대고 도는 `apps/api` 의 검사가 증명한다.
 *
 * 구매자에게는 `enabled: false` 인 줄이 나올 수 없다. 조건(`blockedBy`)이 붙은
 * 전이는 발송뿐이고 그것은 판매자의 것이다.
 */
export function buyerActionsFor(status: OrderStatus): readonly SellerOrderAction[] {
  if (status !== 'DELIVERED') return []

  return [{ to: 'CONFIRMED', enabled: true, blockedBy: null }]
}
