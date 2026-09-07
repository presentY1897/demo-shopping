import type { AdminOrderSearchQueryParams } from '@shopping/shared'
import { adminOrderSearchQueryParamsSchema } from '@shopping/shared'

/**
 * 주문 화면의 순수 판단 — **무엇을 묻고, 사람이 친 것을 언제 돌려보내는가**
 * (TASK-0095).
 *
 * `lib/catalog/product-console.ts` 와 같은 자리에 같은 이유로 있다: 여기 있는 것들은
 * 전부 **틀려도 조용하다.**
 *
 * | 무엇이 틀리면 | 화면은 |
 * | --- | --- |
 * | 필터 → 질의 | 「이 조건에 주문이 없어요」를 멀쩡히 그린다. CS 는 그것을 「그런 주문 없음」으로 읽고 전화를 끊는다 (F4) |
 * | 입력 검사 | uuid 가 아닌 구매자 id 를 그대로 보내 400 을 받고, 화면이 할 수 있는 말은 「입력하신 내용을 다시 확인해 주세요」뿐이다 |
 * | 기간의 앞뒤 | 시작이 끝보다 늦은 기간을 보내고 **언제나 빈 목록**을 받는다 — 그리고 그 빈 목록은 조건 탓이라고 말하지 않는다 |
 *
 * I/O 도 렌더도 없다 (QUALITY-GATES 순수 로직 — `vitest.config.mjs` 가 이 파일을
 * 분기 100% 로 잡고 있다).
 */

/**
 * 주문번호의 상한.
 *
 * **계약의 값을 옮겨 적은 것이다** — `adminOrderSearchQueryParamsSchema.orderNumber`
 * 가 `.max(40)` 으로 잡고 있는데 그 수는 `@shopping/shared` 에서 이름으로 나오지
 * 않는다. 옮겨 적지 않으면 41자를 붙여 넣은 사람이 받는 것은 그 자리의 안내가 아니라
 * 400 이다 (`lib/users/user-console.ts` 의 `USER_SEARCH_MAX` 와 같은 사정).
 */
export const ORDER_NUMBER_MAX = 40

/** 계약이 정한 구매자 id 의 모양. 규칙을 다시 쓰지 않고 그대로 빌려 쓴다. */
const buyerIdSchema = adminOrderSearchQueryParamsSchema.shape.buyerId

/**
 * 검색 조건이 들고 있는 것.
 *
 * 넷은 **사람이 친 문자열 그대로**이고 빈 문자열이 「안 좁혔다」다. `null` 을 쓰지
 * 않는 이유는 입력 칸의 값이 언제나 문자열이기 때문이다 — 두 표현을 섞으면 칸을 다
 * 지운 순간이 「전체」인지 「빈 값으로 검색」인지 화면마다 달라진다. 스토어만 셀렉트라
 * `null` 이 「전체」다.
 */
export interface OrderFilters {
  readonly orderNumber: string
  readonly buyerId: string
  readonly sellerId: string | null
  /** `YYYY-MM-DD`. `<input type="date">` 가 주는 모양이 곧 계약의 모양이다. */
  readonly from: string
  readonly to: string
}

export const EMPTY_ORDER_FILTERS: OrderFilters = {
  buyerId: '',
  from: '',
  orderNumber: '',
  sellerId: null,
  to: '',
}

/** 하나라도 좁혔는가. 빈 목록이 「없다」인지 「이 조건에 없다」인지를 가른다. */
export function ordersNarrowed(filters: OrderFilters): boolean {
  return (
    filters.orderNumber.trim() !== '' ||
    filters.buyerId.trim() !== '' ||
    filters.sellerId !== null ||
    filters.from !== '' ||
    filters.to !== ''
  )
}

/**
 * 보내기 전에 되돌려보낼 것들.
 *
 * 서버도 둘 다 거절하지만(400과 빈 목록), 거절의 **모양이 다르다**: 잘못된 uuid 는
 * 400 이라 화면이 어느 칸이 문제인지 말할 수 있고, 뒤집힌 기간은 **200 과 빈 목록**이라
 * 아무도 그것이 조건 탓이라고 말해 주지 않는다. 그 두 번째가 이 함수가 있는 이유다.
 */
export const orderFilterIssues = ['buyerId', 'range'] as const

export type OrderFilterIssue = (typeof orderFilterIssues)[number]

export function orderIssuesOf(filters: OrderFilters): readonly OrderFilterIssue[] {
  const issues: OrderFilterIssue[] = []
  const buyerId = filters.buyerId.trim()

  if (buyerId !== '' && !buyerIdSchema.safeParse(buyerId).success) issues.push('buyerId')

  // `YYYY-MM-DD` 는 사전순 비교가 곧 시간순 비교다. 한쪽만 적은 기간은 열린 구간이라
  // 뒤집힐 수가 없다.
  if (filters.from !== '' && filters.to !== '' && filters.from > filters.to) issues.push('range')

  return issues
}

/**
 * 필터를 계약의 질의로. 커서와 개수는 부르는 쪽이 얹는다.
 *
 * 주문번호는 **앞뒤 공백을 뗀다.** 계약도 그렇게 읽지만(`z.string().trim()`), 떼지 않고
 * 보내면 붙여 넣기에 딸려 온 공백 하나가 「정확히 일치」를 어긋나게 만들고 — 그것이
 * 정확히 일치로 찾는 이 문에서는 **아무 주문도 없는 것**이 된다 (4.3).
 */
export function orderQueryOf(filters: OrderFilters): AdminOrderSearchQueryParams {
  const orderNumber = filters.orderNumber.trim()
  const buyerId = filters.buyerId.trim()

  return {
    ...(orderNumber === '' ? {} : { orderNumber }),
    ...(buyerId === '' ? {} : { buyerId }),
    ...(filters.sellerId === null ? {} : { sellerId: filters.sellerId }),
    ...(filters.from === '' ? {} : { from: filters.from }),
    ...(filters.to === '' ? {} : { to: filters.to }),
  }
}
