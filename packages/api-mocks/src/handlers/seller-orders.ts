import type {
  DemoCarrierCode,
  OrderStatus,
  SellerOrderAction,
  SellerOrderListItem,
  SellerOrderResponse,
  Shipment,
} from '@shopping/shared'
import {
  SELLER_ORDER_LIST_DEFAULT_LIMIT,
  sellerOrderActionsResponseSchema,
  sellerOrderListItemSchema,
  sellerOrderDeliveryResponseSchema,
  sellerOrderListQueryParamsSchema,
  sellerOrderListResponseSchema,
  sellerOrderResponseSchema,
  sellerOrderTransitionRequestSchema,
  sellerOrderTransitionResponseSchema,
  shipmentResponseSchema,
  shipSellerOrderRequestSchema,
} from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import { sellerOrderDetail, sellerOrderPage, sellerOrderSummary } from '../fixtures/seller-orders'
import { mockPaths } from '../paths'
import { answering, MockApiError, readBody } from './refusal'

/**
 * 판매자 콘솔의 주문 (TASK-0060), 화면이 물어보는 것만큼.
 *
 * **상태를 갖는다.** 이 화면이 묻는 질문이 전부 상태에 대한 것이기 때문이다 — 7건을
 * 넘기면 한 건이 두 번 나오는가(F7), 발송 처리하면 그 줄의 상태가 바뀌는가(F3),
 * 다섯 건을 골라 보내면 다섯 건이 옮겨지는가(F4), 그중 하나가 실패해도 나머지는
 * 가는가(R1). 얼어붙은 픽스처는 그중 무엇에도 답하지 못하고, 그것으로 검사한 화면은
 * 틀린 일을 하면서 통과한다.
 *
 * 재현하는 것은 **화면이 HTTP 로 관찰할 수 있는 것**뿐이다.
 *
 * | 성질 | 실제 API 가 지키는 방법 |
 * | --- | --- |
 * | id 키셋 페이지네이션 | `WHERE id < cursor ORDER BY id DESC LIMIT n + 1` |
 * | 뱃지는 필터를 보지 않는다 | 요약이 다른 라우트이고 질의를 받지 않는다 |
 * | 버튼은 서버가 정한다 | `availableTransitions(status, actor)` |
 * | 배송완료는 두 표를 함께 옮긴다 | `POST …/delivery` 가 한 트랜잭션 |
 *
 * **모든 응답이 `defineFixture` 를 지난다** — 계약과 어긋난 본문은 그것을 잘못
 * 그릴 화면이 아니라 여기서 실패한다 (C2).
 */

/** 한 줄과 그 뒤에 붙어 있는 것. 상세와 목록이 같은 행을 본다. */
interface OrderRow {
  item: SellerOrderListItem
  detail: SellerOrderResponse
}

let rows: OrderRow[] = []

/** 다음 발송 처리 하나를 실패시킨다 (U6 · R1). */
let nextShipFailure: MockApiError | null = null

export function failNextShipment(error?: MockApiError): void {
  nextShipFailure = error ?? new MockApiError(409, '발송할 수 없는 주문입니다.')
}

/**
 * 픽스처에서 저장소를 다시 만든다. `setupTestServer` 의 리셋이 부른다.
 *
 * **이미 발송된 줄에는 배송을 달아 준다.** 실제 서버에서 `SHIPPED` 인 몫에 배송이
 * 없는 것은 불가능하고(운송장 사본이 복합 외래키로 배송을 가리킨다), 목이 그것을
 * 어기면 「배송완료 처리」가 배송을 못 찾아 404 로 끝난다 — 화면의 결함이 아닌데
 * 화면의 검사가 빨개진다.
 */
export function resetSellerOrderStore(): void {
  nextShipFailure = null
  rows = sellerOrderPage.sellerOrders.map((item) => {
    const shipped = item.status === 'SHIPPED' || item.status === 'DELIVERED'

    return {
      item,
      detail: defineFixture(sellerOrderResponseSchema, {
        ...sellerOrderDetail,
        sellerOrder: {
          ...sellerOrderDetail.sellerOrder,
          id: item.id,
          status: item.status,
          paidAmount: item.paidAmount,
          shipment: shipped ? shipmentFor(item.id, item.status) : null,
        },
        orderNumber: item.orderNumber,
        orderedAt: item.orderedAt,
      }),
    }
  })
}

/** 이미 떠난 몫의 배송 한 건. 완료된 줄은 완료 시각과 마지막 사건까지 갖는다. */
function shipmentFor(sellerOrderId: string, status: OrderStatus): Shipment {
  const delivered = status === 'DELIVERED'

  return {
    id: `${sellerOrderId.slice(0, 24)}ffffffffffff`,
    sellerOrderId,
    carrierCode: 'GA',
    carrierName: '가온물류',
    trackingNumber: 'DEMO-GA-000000000001',
    status: delivered ? 'DELIVERED' : 'IN_TRANSIT',
    shippedAt: '2026-09-06T03:00:00.000Z',
    deliveredAt: delivered ? '2026-09-06T09:00:00.000Z' : null,
    events: [
      {
        id: `${sellerOrderId.slice(0, 24)}ee0000000001`,
        kind: 'PICKED_UP',
        location: '가온물류 남부터미널',
        description: '판매자로부터 상품을 인수했어요.',
        occurredAt: '2026-09-06T03:00:00.000Z',
      },
    ],
  }
}

resetSellerOrderStore()

/** 저장소가 지금 들고 있는 것 — 검사가 단언할 수 있게. */
export function sellerOrderSnapshot(): readonly SellerOrderListItem[] {
  return rows.map((row) => row.item)
}

function rowOf(id: string): OrderRow {
  const row = rows.find((candidate) => candidate.item.id === id)

  if (row === undefined) throw new MockApiError(404, '주문을 찾을 수 없습니다.')

  return row
}

/**
 * 이 상태에서 판매자가 할 수 있는 것 — 서버의 전이표를 그대로.
 *
 * **화면이 상태로 분기하지 않게 하는 답이라, 목도 그것을 답해야 한다.** 목이 늘 같은
 * 버튼을 주면 「상태가 바뀌면 버튼도 바뀐다」가 검사에서 사라진다.
 */
const SELLER_ACTIONS: Readonly<Record<OrderStatus, readonly SellerOrderAction[]>> = {
  PAYMENT_PENDING: [],
  PAYMENT_FAILED: [],
  PAID: [
    { to: 'PREPARING', enabled: true, blockedBy: null },
    { to: 'CANCELED', enabled: true, blockedBy: null },
  ],
  // 운송장이 없으므로 발송은 **보이되 눌리지 않는다** — 감추지 않는 것이 규약이다.
  PREPARING: [
    { to: 'SHIPPED', enabled: false, blockedBy: 'tracking' },
    { to: 'CANCELED', enabled: true, blockedBy: null },
  ],
  SHIPPED: [{ to: 'DELIVERED', enabled: true, blockedBy: null }],
  DELIVERED: [{ to: 'RETURNED', enabled: true, blockedBy: null }],
  CONFIRMED: [],
  CANCELED: [],
  RETURNED: [],
}

/** 발급된 가상 운송장 하나. 형식은 `Shipment_trackingNumber_format_check` 의 것이다. */
function issueShipment(row: OrderRow, carrierCode: DemoCarrierCode): Shipment {
  return {
    // uuid 의 마지막 마디는 **열두 자리**다. 짧게 만들면 계약의 `z.uuid()` 가
    // 거절하고, 그 실패는 화면에서 500 으로 보인다 — 목의 결함인데 서버의 결함처럼
    // 읽힌다.
    id: `${row.item.id.slice(0, 24)}ffffffffffff`,
    sellerOrderId: row.item.id,
    carrierCode,
    carrierName: '가온물류',
    trackingNumber: `DEMO-${carrierCode}-${row.item.orderNumber.slice(-8)}0000`,
    status: 'READY',
    shippedAt: '2026-09-06T03:00:00.000Z',
    deliveredAt: null,
    events: [
      {
        id: `${row.item.id.slice(0, 24)}ee0000000001`,
        kind: 'PICKED_UP',
        location: '가온물류 남부터미널',
        description: '판매자로부터 상품을 인수했어요.',
        occurredAt: '2026-09-06T03:00:00.000Z',
      },
    ],
  }
}

/** 상태를 옮기고, 목록과 상세를 **함께** 새로 만든다. 갈리면 화면이 두 말을 한다. */
function moveTo(row: OrderRow, status: OrderStatus, shipment?: Shipment): void {
  row.item = defineFixture(sellerOrderListItemSchema, {
    ...row.item,
    status,
    trackingNumber: shipment?.trackingNumber ?? row.item.trackingNumber,
  })
  row.detail = defineFixture(sellerOrderResponseSchema, {
    ...row.detail,
    sellerOrder: {
      ...row.detail.sellerOrder,
      status,
      shipment: shipment ?? row.detail.sellerOrder.shipment,
      // 확정된 몫은 더 이상 자동 확정을 기다리지 않는다 (TASK-0064).
      autoConfirmAt: status === 'DELIVERED' ? row.detail.sellerOrder.autoConfirmAt : null,
      // 상태를 옮기면 이력이 한 줄 자란다. 이력이 묶음 안에 있으므로 이 갱신도
      // 여기서 일어나고, 그래야 상태와 이력이 갈리지 않는다.
      history: [
        ...row.detail.sellerOrder.history,
        {
          id: `${row.item.id.slice(0, 24)}dd${String(row.detail.sellerOrder.history.length).padStart(10, '0')}`,
          fromStatus: row.detail.sellerOrder.status,
          toStatus: status,
          actor: 'SELLER',
          reason: null,
          occurredAt: '2026-09-06T03:00:00.000Z',
        },
      ],
    },
  })
}

function actionsOf(row: OrderRow): readonly SellerOrderAction[] {
  const base = SELLER_ACTIONS[row.item.status]

  // 운송장이 붙으면 발송이 눌린다 — 실제 서버에서 그 조건은 `SellerOrder.trackingNumber` 다.
  return base.map((action) =>
    action.to === 'SHIPPED' && row.item.trackingNumber !== null
      ? { ...action, enabled: true, blockedBy: null }
      : action,
  )
}

export const sellerOrderHandlers: readonly RequestHandler[] = [
  /**
   * `GET /seller-orders/summary` — **`:id` 보다 먼저**.
   *
   * msw 는 먼저 맞는 것을 쓴다. 아래에 두면 `summary` 가 주문 id 로 읽히고, 증상은
   * 「뱃지가 안 보인다」다 — 실제 서버에서 라우트 순서가 문제였던 것과 같은 함정이라
   * 목에서도 같은 순서를 지킨다.
   */
  http.get(mockPaths.sellerOrdersSummary, () =>
    answering(() => HttpResponse.json(sellerOrderSummary)),
  ),

  /** `GET /seller-orders` — 한 페이지, 걸러서. */
  http.get(mockPaths.sellerOrders, ({ request }) =>
    answering(() => {
      const url = new URL(request.url)
      const query = sellerOrderListQueryParamsSchema.parse(
        Object.fromEntries(url.searchParams.entries()),
      )
      const limit = query.limit ?? SELLER_ORDER_LIST_DEFAULT_LIMIT
      const matches = rows
        .map((row) => row.item)
        // 최신순. id 가 정렬 가능하므로 뒤집으면 그것이 곧 `ORDER BY id DESC` 다.
        .toReversed()
        .filter((item) => query.status === undefined || query.status.includes(item.status))
        .filter((item) => query.from === undefined || item.orderedAt >= query.from)
        .filter((item) => query.to === undefined || item.orderedAt <= query.to)
        .filter(
          (item) =>
            query.q === undefined ||
            item.orderNumber.includes(query.q) ||
            item.maskedRecipientName.includes(query.q),
        )
      const after =
        query.cursor === undefined ? 0 : matches.findIndex((item) => item.id === query.cursor) + 1
      const page = matches.slice(after, after + limit)
      const nextCursor = after + limit < matches.length ? (page.at(-1)?.id ?? null) : null

      return HttpResponse.json(
        defineFixture(sellerOrderListResponseSchema, { sellerOrders: page, nextCursor }),
      )
    }),
  ),

  /** `GET /seller-orders/:id/actions` — 지금 누를 수 있는 것. */
  http.get(mockPaths.sellerOrderActions, ({ params }) =>
    answering(() => {
      const row = rowOf(String(params.id))

      return HttpResponse.json(
        defineFixture(sellerOrderActionsResponseSchema, {
          status: row.item.status,
          actions: [...actionsOf(row)],
        }),
      )
    }),
  ),

  /** `POST /seller-orders/:id/shipment` — 운송장 발급 · 전이 · 첫 사건이 함께. */
  http.post(mockPaths.sellerOrderShipment, ({ params, request }) =>
    answering(async () => {
      const body = await readBody(request, shipSellerOrderRequestSchema)
      const row = rowOf(String(params.id))

      if (nextShipFailure !== null) {
        const failure = nextShipFailure
        nextShipFailure = null
        throw failure
      }

      const shipment = issueShipment(row, body.carrierCode ?? 'GA')

      moveTo(row, 'SHIPPED', shipment)

      return HttpResponse.json(defineFixture(shipmentResponseSchema, { shipment }))
    }),
  ),

  /**
   * `POST /seller-orders/:id/delivery` — **두 표가 함께 움직인다** (TASK-0060 4.3).
   *
   * 목이 배송 쪽을 그대로 두면 「전이만 찍었을 때 추적 화면이 이동 중에 남는다」는
   * 결함이 검사에서 재현되고, 그것은 이 라우트가 없애려던 것이다.
   */
  http.post(mockPaths.sellerOrderDelivery, ({ params }) =>
    answering(() => {
      const row = rowOf(String(params.id))
      const shipment = row.detail.sellerOrder.shipment

      if (shipment === null) throw new MockApiError(404, '배송 정보를 찾을 수 없습니다.')

      const delivered: Shipment = {
        ...shipment,
        status: 'DELIVERED',
        deliveredAt: '2026-09-06T09:00:00.000Z',
        events: [
          ...shipment.events,
          {
            id: `${row.item.id.slice(0, 24)}ee0000000002`,
            kind: 'DELIVERED',
            location: '판매자 직접 확인',
            description: '판매자가 배송 완료를 확인했어요.',
            occurredAt: '2026-09-06T09:00:00.000Z',
          },
        ],
      }

      moveTo(row, 'DELIVERED', delivered)

      return HttpResponse.json(
        defineFixture(sellerOrderDeliveryResponseSchema, {
          transition: {
            id: row.item.id,
            status: 'DELIVERED',
            changed: true,
            actions: [...actionsOf(row)],
          },
          shipment: delivered,
        }),
      )
    }),
  ),

  /** `POST /seller-orders/:id/transitions` — 나머지 이동. */
  http.post(mockPaths.sellerOrderTransitions, ({ params, request }) =>
    answering(async () => {
      const body = await readBody(request, sellerOrderTransitionRequestSchema)
      const row = rowOf(String(params.id))
      const allowed = actionsOf(row).find((action) => action.to === body.to)

      if (allowed?.enabled !== true) {
        throw new MockApiError(409, '지금 상태에서는 할 수 없는 요청입니다.', {
          code: 'ORDER_TRANSITION_UNDEFINED',
          field: 'to',
        })
      }

      moveTo(row, body.to)

      return HttpResponse.json(
        defineFixture(sellerOrderTransitionResponseSchema, {
          id: row.item.id,
          status: body.to,
          changed: true,
          actions: [...actionsOf(row)],
        }),
      )
    }),
  ),

  /** `GET /seller-orders/:id` — 항목 · 수령인 · 금액 · 배송 · 이력. */
  http.get(mockPaths.sellerOrder, ({ params }) =>
    answering(() => HttpResponse.json(rowOf(String(params.id)).detail)),
  ),
]
