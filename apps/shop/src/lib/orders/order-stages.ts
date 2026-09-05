import type { OrderStatus, SellerOrder, SellerOrderHistoryEntry } from '@shopping/shared'

/**
 * 주문 상태 타임라인이 그려지기 전에 결정되는 것 (TASK-0063).
 *
 * ## 사다리 위에 이력을 얹는다 — 덮어쓰지 않는다
 *
 * 묶음이 **자기 이력**을 들고 온다 (`sellerOrderSchema.history`). 그래서 「언제
 * 준비중이 됐나」는 이제 답할 수 있는 질문이다 — 이력이 판매자 응답 최상위에만
 * 있던 동안 이 파일이 만들 수 있는 것은 갈 길의 사다리뿐이었고, 시각은 배송 행이
 * 아는 둘밖에 없었다.
 *
 * **그래도 만드는 것은 여전히 다섯 칸짜리 사다리다.** 이력을 그대로 늘어놓지 않는
 * 이유는 둘이다.
 *
 * 1. **이력에는 사다리에 없는 줄이 있다.** `null → PAYMENT_PENDING` 이 언제나 첫
 *    줄이고, 그것은 「주문이 접수됐다」이지 진행의 한 칸이 아니다.
 * 2. **아직 오지 않은 칸도 보여야 한다.** 이력만 그리면 준비중인 주문의 화면에는
 *    두 줄이 있고, 배송이 남았다는 사실이 어디에도 없다.
 *
 * 그래서 칸은 고정이고 **시각만 이력에서 온다.** 이력에 없는 칸은 계속 시각이
 * 없다 — 이력이 빈 주문(상태 이력이 쌓이기 전의 것)에서는 다섯 칸이 전부 「시각
 * 정보 없음」이고, 그것이 정확한 표현이다.
 *
 * | 칸 | 시각 | 어디서 |
 * | --- | --- | --- |
 * | 결제완료 | `PAID` 로 옮긴 이력 줄 | 결제 승인이 적는다 |
 * | 상품준비중 | `PREPARING` 줄 | 판매자가 적는다 |
 * | 배송중 | `SHIPPED` 줄, 없으면 `shipment.shippedAt` | |
 * | 배송완료 | `DELIVERED` 줄, 없으면 `shipment.deliveredAt` | |
 * | 구매확정 | `CONFIRMED` 줄 | |
 *
 * **배송 행이 물러난 것이 아니라 뒤로 갔다.** 실제 서버는 전이와 배송을 한
 * 트랜잭션에서 쓰므로 두 값이 같지만, 둘 중 하나만 있는 응답이 오면 아는 쪽을
 * 쓴다 — 「상태가 옮겨진 시각」과 「물건이 실린 시각」은 원래 다른 사실이고, 여기서
 * 답해야 하는 것은 앞쪽이라 이력이 먼저다.
 *
 * 「결제완료 · 2026-09-05」처럼 **주문 접수 시각을 결제 시각 자리에 놓는 것**은
 * 여전히 하지 않는다. 그것이 가장 하기 쉬운 거짓말이고, `createdAt` 이 이 파일에
 * 들어오지 않는 이유다.
 *
 * ## 사다리를 벗어난 상태가 있다
 *
 * 취소·반품·결제실패·결제대기는 사다리 위의 한 칸이 아니다. 취소된 주문에
 * 「배송중 → 배송완료 → 구매확정」이 회색으로 남아 있으면 화면은 아직 그리로 갈 것
 * 처럼 말하게 된다. 그래서 {@link orderStages} 가 `null` 을 돌려주고, 화면은 사다리
 * 대신 **한 문장**을 그린다.
 *
 * React 도 DOM 도 없다. 입력 → 출력이라 렌더 없이 검증된다.
 */

/**
 * 구매자가 보는 사다리 다섯 칸. **순서가 곧 의미**다.
 *
 * `PAYMENT_PENDING` 이 맨 앞에 없는 것은 그것이 「주문이 진행 중」이 아니라 「아직
 * 시작 안 했다」이기 때문이다 — 결제되지 않은 주문에 사다리를 그리면 네 칸이 모두
 * 예정이고, 그 그림이 말하는 것은 아무것도 없다.
 */
export const ORDER_STAGES = ['PAID', 'PREPARING', 'SHIPPED', 'DELIVERED', 'CONFIRMED'] as const

export type OrderStage = (typeof ORDER_STAGES)[number]

/** 한 칸이 놓인 자리. 배송 4단계 표시와 같은 세 값이다 (`packages/ui` 의 규약). */
export const ORDER_STAGE_STATES = ['done', 'current', 'upcoming'] as const

export type OrderStageState = (typeof ORDER_STAGE_STATES)[number]

export interface OrderStageStep {
  readonly stage: OrderStage
  readonly state: OrderStageState
  /** 이 칸이 언제였는지 **아는 경우에만** 값이 있다. 모르면 `null` 이다. */
  readonly at: string | null
}

/** 사다리 위의 상태인가. 아니면 이 주문은 다른 이야기를 하고 있다. */
export function isOnLadder(status: OrderStatus): status is OrderStage {
  return (ORDER_STAGES as readonly OrderStatus[]).includes(status)
}

/**
 * 이 칸에 들어온 시각, 이력이 모르면 `null`.
 *
 * **처음 들어온 줄을 쓴다.** 전이표(`seller-order-transitions.ts`)에 순환이 없어
 * 한 상태로 두 번 들어올 수 없으므로 실제로는 줄이 하나뿐이지만, 골라야 한다면
 * 「언제 이 칸에 왔나」의 답은 처음이다.
 */
function enteredAt(history: readonly SellerOrderHistoryEntry[], stage: OrderStage): string | null {
  return history.find((entry) => entry.toStatus === stage)?.occurredAt ?? null
}

/**
 * 이 묶음의 사다리, 또는 사다리를 벗어났으면 `null`.
 *
 * 시각은 이력에서 오고, 이력이 그 칸을 모르면 배송 행이 아는 둘로 메운다. 둘 다
 * 없으면 `null` 이고 화면은 「시각 정보 없음」을 적는다 — 빈칸으로 두면 「그런 일이
 * 없었다」로 읽힌다.
 */
export function orderStages(sellerOrder: SellerOrder): readonly OrderStageStep[] | null {
  const { status, shipment, history } = sellerOrder

  if (!isOnLadder(status)) return null

  const currentIndex = ORDER_STAGES.indexOf(status)

  const at: Readonly<Record<OrderStage, string | null>> = {
    PAID: enteredAt(history, 'PAID'),
    PREPARING: enteredAt(history, 'PREPARING'),
    // 배송 행은 **뒤에 선다.** 이 칸이 답하는 것은 「상태가 언제 옮겨졌나」이고,
    // 이력이 그것을 안다면 그 값이 답이다.
    SHIPPED: enteredAt(history, 'SHIPPED') ?? shipment?.shippedAt ?? null,
    DELIVERED: enteredAt(history, 'DELIVERED') ?? shipment?.deliveredAt ?? null,
    CONFIRMED: enteredAt(history, 'CONFIRMED'),
  }

  return ORDER_STAGES.map((stage, index) => ({
    stage,
    state: stageStateAt(index, currentIndex),
    // 아직 오지 않은 칸에는 시각을 싣지 않는다. 배송완료 시각이 있는데 상태가
    // 아직 `SHIPPED` 인 데이터가 오면(사건이 순서를 뒤집어 도착한 경우) 「예정」인
    // 칸에 지난 시각이 붙어 화면이 스스로와 모순된다.
    at: stageStateAt(index, currentIndex) === 'upcoming' ? null : at[stage],
  }))
}

/**
 * 칸 하나의 자리.
 *
 * 「지난 칸 / 지금 칸 / 남은 칸」 셋뿐이다. 화면은 이 값으로 **모양과 문구**를 고르고,
 * 색은 그 위에 얹힐 뿐이다 (WCAG 1.4.1).
 */
export function stageStateAt(index: number, currentIndex: number): OrderStageState {
  if (index < currentIndex) return 'done'
  if (index === currentIndex) return 'current'

  return 'upcoming'
}
