import type {
  Order,
  OrderListResponse,
  OrderStatus,
  OrderSummary,
  SellerOrder,
} from '@shopping/shared'
import {
  orderListQueryParamsSchema,
  orderListResponseSchema,
  orderResponseSchema,
  sellerOrderActionsResponseSchema,
  sellerOrderTransitionRequestSchema,
  sellerOrderTransitionResponseSchema,
} from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import {
  shopperCanceledOrder,
  shopperConfirmedOrder,
  shopperDeletedProductOrder,
  shopperMixedOrder,
  shopperOrderPage,
  shopperOrderPageTwo,
} from '../fixtures/orders'
import { mockPaths } from '../paths'
import { buyerActionsFor, MOCK_ORDER_NOW } from './order-contract'
import { answering, MockApiError, readBody } from './refusal'

/**
 * 구매자의 주문 내역 (TASK-0063 의 화면이 읽는다).
 *
 * **상태를 갖는다** — `handlers/checkout.ts` 와 같은 이유다. 이 화면이 묻는 것 중
 * 하나가 「구매확정을 누르면 무엇이 달라지는가」이고, 얼어붙은 픽스처는 거기에 답할
 * 수 없다: 확정 뒤에는 상태가 `CONFIRMED` 여야 하고, 그 묶음의 액션 목록이 **비어야**
 * 하며, 두 번 눌러도 실패가 아니라 `changed: false` 여야 한다.
 *
 * ## 목록은 서버처럼 **거르고 나서** 자른다
 *
 * 다섯 건을 한 줄로 들고 있다가 질의(`orderListQueryParamsSchema`)로 거른 뒤
 * {@link MOCK_ORDER_PAGE_SIZE} 만큼 잘라 낸다. 미리 잘라 둔 두 장을 번갈아 주면
 * **필터가 페이지네이션과 어떻게 만나는지**를 잴 수 없다 — 서버가 거르고 나서
 * 자르므로 「걸러진 결과가 한 장에 다 들어가면 `nextCursor` 가 `null`」이 참이어야
 * 하고, 그것이 화면에서 「더 보기」가 사라지는 조건이다.
 *
 * 그래도 **두 장이 나오는 것**은 그대로다(다섯 건 ÷ 세 줄). 「더 보기」가 눌린 뒤
 * 앞 장이 사라지지 않는지를 확인할 자리가 거기밖에 없다.
 *
 * ## 재현하지 않는 것
 *
 * 남의 주문을 읽었을 때의 403, D+7 자동 확정, 상태 머신 전체. 앞의 둘은 실
 * PostgreSQL 에 대고 도는 `apps/api` 의 검사가 이미 증명하고(QUALITY-GATES 6장),
 * 마지막 것은 구매자에게 열린 전이가 하나뿐이라 표를 옮겨 적을 필요가 없다
 * (`order-contract.ts`).
 *
 * 모든 응답이 `defineFixture` 를 지나므로 계약에서 벗어난 페이로드는 그것을 잘못
 * 그리는 화면이 아니라 **여기서** 실패한다 (게이트 C2).
 */

/** 상세로 답할 수 있는 주문들. 검사가 갈아 끼우는 것은 아래 `store` 다. */
const SEED_ORDERS: readonly Order[] = [
  shopperMixedOrder.order,
  shopperConfirmedOrder.order,
  shopperCanceledOrder.order,
  shopperDeletedProductOrder.order,
]

/**
 * 대역의 한 장 크기.
 *
 * 실제 기본값(`ORDER_LIST_DEFAULT_LIMIT` 20)보다 작게 잡는다. 픽스처가 다섯
 * 건이라 20으로 자르면 한 장에 다 들어가고, 그러면 커서가 아무 일도 하지 않는데
 * 검사가 초록이다.
 */
export const MOCK_ORDER_PAGE_SIZE = 3

/** 목록이 들고 있는 전부 — 최신순 다섯 건. 두 장짜리 픽스처를 이어 붙인 것이다. */
const SEED_SUMMARIES: readonly OrderSummary[] = [
  ...shopperOrderPage.orders,
  ...shopperOrderPageTwo.orders,
]

interface OrderStore {
  /** 목록 전부. 핸들러가 거르고 자른다 — 미리 잘린 장을 들고 있지 않는다. */
  readonly summaries: readonly OrderSummary[]
  /** 상세. 전이가 여기의 상태를 옮긴다. */
  readonly orders: readonly Order[]
}

const INITIAL: OrderStore = { summaries: SEED_SUMMARIES, orders: SEED_ORDERS }

let store: OrderStore = INITIAL

function orderById(id: string): Order {
  const found = store.orders.find((order) => order.id === id)

  if (found === undefined) throw new MockApiError(404, '주문을 찾을 수 없어요.')

  return found
}

/** 어느 주문의 어느 묶음인가. 전이 라우트는 묶음 id 만 들고 온다. */
function sellerOrderById(id: string): { readonly order: Order; readonly bundle: SellerOrder } {
  for (const order of store.orders) {
    const bundle = order.sellerOrders.find((sellerOrder) => sellerOrder.id === id)

    if (bundle !== undefined) return { bundle, order }
  }

  throw new MockApiError(404, '주문을 찾을 수 없어요.')
}

/**
 * 한 묶음의 상태를 옮긴 새 저장소. 나머지는 그대로 둔다.
 *
 * **이력도 한 줄 자란다.** 상태만 옮기면 다시 읽은 상세에서 상태와 이력이 다른
 * 말을 하고, 그 어긋남은 목의 사정인데 화면의 결함처럼 보인다. 주체는 `BUYER` 다 —
 * 구매자에게 열려 있는 전이가 구매확정 하나뿐이라 그것을 누른 사람이 곧 주체다.
 */
function withStatus(sellerOrderId: string, status: OrderStatus): OrderStore {
  return {
    ...store,
    orders: store.orders.map((order) => ({
      ...order,
      sellerOrders: order.sellerOrders.map((bundle) =>
        bundle.id === sellerOrderId
          ? {
              ...bundle,
              status,
              // 확정된 몫은 더 이상 자동 확정을 기다리지 않는다 — 실제 서버가
              // 답하는 값과 같게 둔다 (TASK-0064). 목이 옛 예정일을 들고 있으면
              // 화면은 「확정됐는데 예정일이 남아 있는」 상태를 그리게 된다.
              autoConfirmAt: status === 'DELIVERED' ? bundle.autoConfirmAt : null,
              history: [
                ...bundle.history,
                {
                  id: `${bundle.id.slice(0, 24)}ff${String(bundle.history.length).padStart(10, '0')}`,
                  fromStatus: bundle.status,
                  toStatus: status,
                  actor: 'BUYER' as const,
                  reason: null,
                  occurredAt: MOCK_ORDER_NOW,
                },
              ],
            }
          : bundle,
      ),
    })),
  }
}

function actionsResponse(status: OrderStatus): Response {
  return HttpResponse.json(
    defineFixture(sellerOrderActionsResponseSchema, {
      status,
      actions: [...buyerActionsFor(status)],
    }),
  )
}

export const orderHandlers: readonly RequestHandler[] = [
  /**
   * 내 주문 목록 — 최신순, **상태·기간으로 거르고**, 커서 페이지네이션.
   *
   * 질의를 **서버와 같은 스키마**로 읽는다 (`orderListQueryParamsSchema`). 대역이
   * 자기 규칙으로 파싱하면 「쉼표 목록인가 반복 키인가」 같은 것이 두 곳에 적히고,
   * 화면이 실제 API 에는 없는 문법에 기대게 된다.
   *
   * **상태 필터의 뜻은 「하나라도」다.** 서버의 `sellerOrders: { some: ... }` 와
   * 같은 뜻이고(`order.service.ts` 가 왜 그런지 적어 두었다), 목록의 한 줄이
   * `statuses` 배열을 들고 있으므로 여기서는 그것과의 교집합이 비지 않는지를 본다.
   */
  http.get(mockPaths.orders, ({ request }) =>
    answering(() => {
      const url = new URL(request.url)
      const query = orderListQueryParamsSchema.parse(Object.fromEntries(url.searchParams.entries()))
      const limit = query.limit ?? MOCK_ORDER_PAGE_SIZE
      const matches = store.summaries
        .filter(
          (order) =>
            query.status === undefined ||
            order.statuses.some((status) => query.status?.includes(status) === true),
        )
        .filter((order) => query.from === undefined || order.createdAt >= query.from)
        .filter((order) => query.to === undefined || order.createdAt <= query.to)

      // 커서는 「마지막으로 본 줄의 id」다. 서버가 `id: { lt: cursor }` 로 다음 장을
      // 뜨므로 목도 그 줄 **다음**부터 자른다.
      const start =
        query.cursor === undefined ? 0 : matches.findIndex((order) => order.id === query.cursor) + 1
      const page = matches.slice(start, start + limit)

      return HttpResponse.json(
        defineFixture(orderListResponseSchema, {
          orders: page,
          nextCursor: start + limit < matches.length ? (page.at(-1)?.id ?? null) : null,
        }),
      )
    }),
  ),

  /** 주문 하나. 묶음마다 상태와 배송이 들어 있다. */
  http.get(mockPaths.order, ({ params }) =>
    answering(() =>
      HttpResponse.json(
        defineFixture(orderResponseSchema, { order: orderById(String(params.id)) }),
      ),
    ),
  ),

  /**
   * 지금 이 사람이 이 묶음에 할 수 있는 것.
   *
   * 화면이 상태로 분기하지 않게 하는 답이다 — 그래서 이 대역도 상태를 보고 목록을
   * 만들지, 화면에게 상태만 주고 판단을 넘기지 않는다.
   */
  http.get(mockPaths.sellerOrderActions, ({ params }) =>
    answering(() => actionsResponse(sellerOrderById(String(params.id)).bundle.status)),
  ),

  /**
   * 다음 상태로 옮긴다.
   *
   * **멱등이다.** 이미 그 상태면 성공으로 답하고 `changed: false` 를 싣는다 —
   * 재시도한 화면에 오류를 보이는 것은, 그 사람이 원한 결과가 이미 이뤄져 있는데
   * 실패했다고 말하는 것이다.
   *
   * 구매자가 요구할 수 없는 전이는 409 가 아니라 **403** 이다. 요청 자체는 말이
   * 되지만 이 사람의 것이 아니고, 실제 서비스도 `actor_forbidden` 을 그렇게 답한다.
   */
  http.post(mockPaths.sellerOrderTransitions, ({ params, request }) =>
    answering(async () => {
      const id = String(params.id)
      const { to } = await readBody(request, sellerOrderTransitionRequestSchema)
      const { bundle } = sellerOrderById(id)

      if (bundle.status === to) {
        return HttpResponse.json(
          defineFixture(sellerOrderTransitionResponseSchema, {
            id,
            status: to,
            changed: false,
            actions: [...buyerActionsFor(to)],
          }),
        )
      }

      if (!buyerActionsFor(bundle.status).some((action) => action.to === to)) {
        throw new MockApiError(403, '이 주문을 그 상태로 옮길 수 없어요.')
      }

      store = withStatus(id, to)

      return HttpResponse.json(
        defineFixture(sellerOrderTransitionResponseSchema, {
          id,
          status: to,
          changed: true,
          actions: [...buyerActionsFor(to)],
        }),
      )
    }),
  ),
]

/**
 * 이 목의 주문을 처음 상태로.
 *
 * 빈 목록으로 시작하려면 `noOrders` 를 넘긴다 — 그것만 넘기면 상세도 함께 비워야
 * 앞뒤가 맞으므로, 목록을 비우는 것이 곧 상세를 비우는 것이다.
 *
 * 인자가 「한 장」인 것은 이 함수를 부르는 검사들이 그렇게 읽기 때문이다. 목이
 * 들고 있는 것은 이제 장이 아니라 **줄 전부**라, 기본값이 오면 다섯 건을 다시
 * 세우고 다른 것이 오면 그 줄들만 남긴다.
 */
export function resetOrderStore(
  firstPage: OrderListResponse = shopperOrderPage,
  orders: readonly Order[] = SEED_ORDERS,
): void {
  store = {
    summaries: firstPage === shopperOrderPage ? SEED_SUMMARIES : firstPage.orders,
    orders,
  }
}
