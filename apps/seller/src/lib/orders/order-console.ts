import type { OrderStatus, SellerOrderAction } from '@shopping/shared'

/**
 * 주문 화면의 순수 판단 — 탭이 무엇을 뜻하고, 버튼이 어느 문을 두드리는가.
 *
 * I/O 가 없으므로 분기 전부가 단위 테스트에서 닿는다. 여기 있는 이유는 둘 다 **틀려도
 * 조용하기** 때문이다: 탭의 상태 집합이 어긋나면 판매자가 「배송중」 탭에서 자기
 * 주문을 못 찾고, 버튼의 목적지가 어긋나면 **두 표가 갈린다**(아래).
 */

/**
 * 상태 탭 (설계서 4장).
 *
 * `null` 은 「전체」다 — 서버에 상태 파라미터를 보내지 않는다는 뜻이고, 빈 배열이
 * 아니다. 빈 배열은 「아무 상태도 아닌 것」이라 언제나 0건이 된다.
 *
 * **취소·반품이 둘인 것이 이 표의 존재 이유다.** 탭 하나가 상태 하나였다면 화면은
 * 상태 열거형을 그대로 그리면 됐다. 그래서 계약의 `status` 파라미터가 목록이고,
 * 탭의 정의는 **화면에 남는다** — 설계서가 그것을 소유한다.
 */
export const SELLER_ORDER_TABS = [
  'all',
  'paid',
  'preparing',
  'shipped',
  'delivered',
  'closed',
] as const

export type SellerOrderTab = (typeof SELLER_ORDER_TABS)[number]

const TAB_STATUSES: Readonly<Record<SellerOrderTab, readonly OrderStatus[] | null>> = {
  all: null,
  paid: ['PAID'],
  preparing: ['PREPARING'],
  shipped: ['SHIPPED'],
  delivered: ['DELIVERED'],
  closed: ['CANCELED', 'RETURNED'],
}

/** 이 탭이 서버에 보낼 상태 목록, 또는 「전체」를 뜻하는 `null`. */
export function statusesOf(tab: SellerOrderTab): readonly OrderStatus[] | null {
  return TAB_STATUSES[tab]
}

/**
 * 이 탭의 건수 — 상태별 건수를 더해서.
 *
 * 「전체」는 전 상태의 합이다. `PAYMENT_PENDING` 까지 세는 것은 그것도 판매자의
 * 주문이기 때문이고, 탭이 그것을 감추면 목록과 숫자가 어긋난다.
 */
export function tabCountOf(
  tab: SellerOrderTab,
  counts: Readonly<Record<OrderStatus, number>>,
): number {
  const statuses = statusesOf(tab)

  if (statuses === null) {
    return Object.values(counts).reduce((total, count) => total + count, 0)
  }

  return statuses.reduce((total, status) => total + counts[status], 0)
}

/**
 * 액션 버튼이 두드릴 문 (TASK-0060 4.3).
 *
 * **가능 액션 API 는 「어느 상태로 갈 수 있는가」만 답한다.** 그 상태로 가는 길이
 * 라우트 하나가 아닌 것이 이 표의 이유이고, 세 갈래는 전부 서버가 그렇게 나눠 둔
 * 것이다.
 *
 * | 목적지 | 문 | 왜 |
 * | --- | --- | --- |
 * | `SHIPPED` | `POST …/shipment` | 전이의 문은 **운송장을 요구**하고, 그것을 만드는 것이 이 라우트다 (TASK-0061) |
 * | `DELIVERED` | `POST …/delivery` | 전이만 찍으면 `Shipment.status` 가 따라오지 않아 **두 표가 갈린다** (TASK-0061 4.4) |
 * | 나머지 | `POST …/transitions` | 상태 말고 따라 움직일 것이 없다 |
 *
 * 이 판단이 화면에 있는 것은 「상태로 분기한다」와 다르다. 분기하는 것은 **버튼을
 * 보일지**가 아니라 **이미 서버가 준 버튼을 어디로 보낼지**이고, 그 대응은 라우트
 * 목록이지 상태 머신이 아니다. 규칙이 흩어지지 않도록 자리는 **여기 하나**다.
 */
export const SELLER_ORDER_ACTION_ROUTES = ['shipment', 'delivery', 'transition'] as const

export type SellerOrderActionRoute = (typeof SELLER_ORDER_ACTION_ROUTES)[number]

export function actionRouteOf(to: OrderStatus): SellerOrderActionRoute {
  if (to === 'SHIPPED') return 'shipment'
  if (to === 'DELIVERED') return 'delivery'

  return 'transition'
}

/**
 * 이 버튼을 **지금 누를 수 있는가.**
 *
 * 서버의 `enabled` 를 그대로 쓰지 않는 **유일한** 자리이고, 그럴 이유가 하나 있다.
 *
 * `PREPARING → SHIPPED` 는 전이의 문 앞에서 **언제나** `enabled: false` ·
 * `blockedBy: 'tracking'` 이다 — 그 문이 운송장을 요구하고, 발송 전에는 운송장이
 * 없기 때문이다. 그런데 **운송장을 만드는 것이 발송 라우트**다(TASK-0061). 그러니
 * 그 답을 그대로 믿고 버튼을 잠그면 판매자는 영영 발송할 수 없고, 화면은 아무 오류도
 * 내지 않은 채 그냥 막혀 있다.
 *
 * 그래서 규칙은 「서버가 막았으면 막는다」가 아니라 **「모자란 조건을 이 문이
 * 채우는가」**다. 채우지 못하는 조건이면 그대로 비활성이고 사유가 붙는다.
 *
 * 이것이 「화면이 상태로 분기한다」가 아닌 이유: 보는 것은 상태가 아니라 **서버가 준
 * 답의 `blockedBy`** 이고, 판단하는 것은 「그 조건을 이 라우트가 만드는가」라는 라우트
 * 의 성질이다. 새 조건이 생기면 아래 표가 컴파일로 답을 요구한다.
 */
export function isPressable(action: SellerOrderAction): boolean {
  return action.enabled || suppliesRequirement(action)
}

/**
 * 이 액션이 가는 문이 그 조건을 **스스로 만드는가.**
 *
 * 지금 그런 짝은 하나다 — 발송 라우트가 운송장을 만든다. 조건이 늘면
 * (`SellerOrderRequirement` 가 커지면) 여기가 그것을 어떻게 다룰지 정해야 하고,
 * 정하지 않으면 그 조건은 「아무도 채워 주지 않는 조건」으로 남는다.
 */
function suppliesRequirement(action: SellerOrderAction): boolean {
  if (action.blockedBy === null) return false

  return actionRouteOf(action.to) === 'shipment' && action.blockedBy === 'tracking'
}

/**
 * 사유를 받아야 하는 이동인가.
 *
 * 취소와 반품은 클레임 절차의 **결론**이라 「왜」가 남아야 한다(`state-machines.md`
 * 4장). 정상 진행에는 사유가 없고, 있으면 판매자는 발송할 때마다 빈 칸을 본다.
 */
export function needsReason(to: OrderStatus): boolean {
  return to === 'CANCELED' || to === 'RETURNED'
}

/**
 * 일괄 발송이 고를 수 있는 줄인가.
 *
 * 목록의 체크박스는 상태를 가리지 않는다 — 고른 뒤에 「이 중 다섯 건은 발송할 수
 * 없어요」라고 말하는 편이, 고를 수 없는 이유를 체크박스가 침묵으로 말하는 것보다
 * 낫다(설계서: 「권한 없는 조작은 숨기지 않고 비활성 + 사유」와 같은 결).
 */
export function isShippable(status: OrderStatus): boolean {
  return status === 'PREPARING'
}

/**
 * 서버가 준 버튼 중 이 목적지의 것, 없으면 `null`.
 *
 * 화면이 「지금 발송할 수 있나」를 상태로 묻지 않게 하는 자리다 — 묻는 것은 언제나
 * **답에 그 버튼이 있는가**이고, `enabled` 와 `blockedBy` 도 그 답에서 온다.
 */
export function actionFor(
  actions: readonly SellerOrderAction[],
  to: OrderStatus,
): SellerOrderAction | null {
  return actions.find((action) => action.to === to) ?? null
}
