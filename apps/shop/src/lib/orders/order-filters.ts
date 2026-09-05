import type { OrderListQuery, OrderStatus } from '@shopping/shared'

/**
 * 주문 목록의 기간·상태 필터 (TASK-0063).
 *
 * ## 여기서 만드는 것은 질의다 — 거름망이 아니다
 *
 * `orderListQuerySchema` 가 이제 `status`(쉼표 목록)·`from`·`to` 를 받는다. 그래서
 * 이 파일이 하는 일은 **화면의 두 셀렉트를 서버가 알아듣는 질의로 옮기는 것**이고,
 * 거르는 일은 서버가 한다.
 *
 * 그전에는 이 파일이 불러온 주문 위에서 걸렀고, 그 대가를 화면이 문장으로 말했다
 * (「조건에 맞는 주문이 더 있을 수 있습니다」). 서버가 거르면 그 문장은 **거짓**이
 * 된다 — 남은 장이 있으면 조건에 맞는 것이 「있을 수 있는」 게 아니라 **있다**.
 * 그래서 그 문장은 사라졌고, 남은 장은 「더 보기」가 말한다.
 *
 * ## 탭의 정의는 화면이 갖는다
 *
 * 서버에 보내는 것은 `OrderStatus` 목록이지 탭 이름이 아니다. 「결제 대기」가
 * `PAYMENT_PENDING` 과 `PAYMENT_FAILED` 둘이라는 것은 이 화면의 사정이고, API 는
 * 어느 화면에서 불려도 같은 뜻을 갖는다 (`orderStatusFilterSchema`).
 *
 * **상태 필터의 뜻은 「이 상태인 묶음이 하나라도 있는 주문」이다.** 한 주문의
 * 묶음들이 서로 다른 상태일 수 있으므로(D-023) 「이 주문의 상태」라는 것이 없고,
 * 「배송중」을 누른 사람이 찾는 것은 지금 오고 있는 물건이다. 서버가 같은 뜻을
 * 갖는다 (`OrderService.list` 가 왜 그런지 적어 두었다).
 *
 * ## React 도 DOM 도 없다
 *
 * 입력 → 출력이라 렌더 없이 검증된다. **현재 시각을 인자로 받는 것**이 그 성질의
 * 핵심이다 (QUALITY-GATES 6장 「시간: 주입」) — `Date.now()` 를 안에서 부르면
 * 「3개월 경계에서 어느 쪽인가」를 값으로 고를 수 없다.
 */

/** 기간 선택지. 값의 순서가 곧 화면에 놓이는 순서다. */
export const orderPeriods = ['1m', '3m', '6m', '1y', 'all'] as const

export type OrderPeriod = (typeof orderPeriods)[number]

/**
 * 기본은 **전부**다.
 *
 * 「최근 3개월」이 더 쓸모 있어 보이지만, 그것은 **사람이 고르지 않은 조건**이라
 * 빈 화면의 뜻을 거짓으로 만든다 — 3개월보다 오래된 주문만 있는 계정이 「아직
 * 주문한 상품이 없습니다」를 보게 된다. 그 문장은 틀렸고, 그 사람에게는 자기
 * 주문이 사라진 것으로 보인다.
 *
 * 성능이 이유가 될 수도 없다. 목록은 어차피 커서 페이지네이션이라 **첫 장의
 * 크기는 기간과 무관**하다. 좁히는 것은 사람이 고를 때만 일어나고, 그때는 빈
 * 결과에 「조건을 지우세요」라고 말할 수 있다.
 */
export const DEFAULT_ORDER_PERIOD: OrderPeriod = 'all'

/**
 * 몇 달 전까지인가. `null` 은 「전부」다.
 *
 * **일수가 아니라 달수다.** 「1개월」을 30일로 치면 31일짜리 달의 1일에 산 물건이
 * 그 달 안에 목록에서 사라진다 — 사람이 「지난달」이라고 부르는 것과 어긋난다.
 */
const PERIOD_MONTHS: Readonly<Record<OrderPeriod, number | null>> = {
  '1m': 1,
  '3m': 3,
  '6m': 6,
  '1y': 12,
  all: null,
}

/**
 * 이 기간의 시작 시각. `null` 이면 자르지 않는다.
 *
 * `setMonth` 가 달의 길이를 알아서 다룬다 — 3월 31일에서 한 달을 빼면 2월 31일이
 * 아니라 3월 3일이 되는 그 동작이 여기서는 맞는 쪽이다. 「한 달 전」의 경계가
 * 하루쯤 흔들리는 것보다, 존재하지 않는 날짜를 기준으로 삼는 편이 나쁘다.
 */
export function periodStart(period: OrderPeriod, now: Date): Date | null {
  const months = PERIOD_MONTHS[period]

  if (months === null) return null

  const start = new Date(now.getTime())
  start.setMonth(start.getMonth() - months)

  return start
}

/**
 * 상태 선택지.
 *
 * **`OrderStatus` 아홉 개를 그대로 늘어놓지 않는다.** 「결제 대기」와 「결제 실패」를
 * 따로 고르는 사람은 없고, 아홉 개짜리 셀렉트는 고르는 일 자체가 일이 된다. 그래서
 * 사는 사람이 실제로 묻는 다섯 가지로 묶는다 — 「아직 안 왔나」 「오는 중인가」
 * 「받았나」 「끝났나」 「엎어졌나」.
 */
export const orderStatusFilters = [
  'all',
  'pending',
  'preparing',
  'shipping',
  'delivered',
  'confirmed',
  'closed',
] as const

export type OrderStatusFilter = (typeof orderStatusFilters)[number]

export const DEFAULT_ORDER_STATUS_FILTER: OrderStatusFilter = 'all'

/**
 * 어느 묶음이 어느 칸에 드는가.
 *
 * **`Record` 라 상태가 하나 늘면 여기가 비는 것이 아니라 컴파일이 깨진다** — 는
 * 것은 절반만 참이다. 키가 필터 쪽이라서 새 `OrderStatus` 는 타입 검사에 안 걸리고,
 * 그것을 잡는 것은 `order-filters.spec.ts` 의 「아홉 개가 정확히 한 번씩 나온다」는
 * 단언이다. 검사 쪽에 둔 이유는 이 표의 성질이 **전수와 배타** 둘 다이기 때문이고,
 * 타입으로는 앞의 절반만 표현된다.
 */
const STATUS_GROUPS: Readonly<Record<Exclude<OrderStatusFilter, 'all'>, readonly OrderStatus[]>> = {
  /** 아직 돈이 넘어가지 않았다. 실패도 여기다 — 사람이 할 일이 「다시 결제」로 같다. */
  pending: ['PAYMENT_PENDING', 'PAYMENT_FAILED'],
  /** 결제는 됐고 아직 안 떠났다. */
  preparing: ['PAID', 'PREPARING'],
  shipping: ['SHIPPED'],
  delivered: ['DELIVERED'],
  confirmed: ['CONFIRMED'],
  /** 엎어진 것들. 취소와 반품은 온 길이 다르지만 지금 할 일이 없는 것은 같다. */
  closed: ['CANCELED', 'RETURNED'],
}

/** 이 필터가 덮는 주문 상태들. 「전체」는 전부다. */
export function statusesIn(filter: OrderStatusFilter): readonly OrderStatus[] {
  if (filter === 'all') return Object.values(STATUS_GROUPS).flat()

  return STATUS_GROUPS[filter]
}

export interface OrderFilter {
  readonly period: OrderPeriod
  readonly status: OrderStatusFilter
}

export const DEFAULT_ORDER_FILTER: OrderFilter = {
  period: DEFAULT_ORDER_PERIOD,
  status: DEFAULT_ORDER_STATUS_FILTER,
}

/** 아무것도 좁히지 않는 상태인가. 화면이 「필터를 지웠다」를 말할 때 읽는다. */
export function isDefaultFilter(filter: OrderFilter): boolean {
  return filter.period === DEFAULT_ORDER_PERIOD && filter.status === DEFAULT_ORDER_STATUS_FILTER
}

/**
 * 이 조건을 서버가 알아듣는 질의로.
 *
 * **「전체」는 파라미터를 만들지 않는다.** 아홉 상태를 전부 나열해 보내면 뜻은 같지만
 * 서버가 하지 않아도 될 일을 하고(9개짜리 `IN`), 무엇보다 URL 이 「전체를 골랐다」와
 * 「아무것도 안 골랐다」를 다르게 적게 된다 — 같은 화면이 두 가지 주소를 갖는다.
 *
 * `to` 는 보내지 않는다. 기간 선택지가 전부 「최근 n개월」이라 끝이 언제나 지금이고,
 * 「지금」을 파라미터로 적으면 새로고침할 때마다 다른 질의가 된다. 계약에는 `to` 가
 * 있고(판매자 콘솔이 쓴다), 이 화면이 아직 그것을 물을 자리가 없을 뿐이다.
 */
export function orderListQueryOf(filter: OrderFilter, now: Date): OrderListQuery {
  const start = periodStart(filter.period, now)

  return {
    ...(filter.status === 'all' ? {} : { status: [...statusesIn(filter.status)] }),
    ...(start === null ? {} : { from: start.toISOString() }),
  }
}
