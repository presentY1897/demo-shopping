import { randomUUID } from 'node:crypto'

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import type {
  ApiClient,
  OrderStatus,
  SellerOrderListItem,
  SellerOrderListResponse,
} from '@shopping/shared'
import {
  ApiClientError,
  cartResponseSchema,
  orderResponseSchema,
  sellerOrderActionsResponseSchema,
  sellerOrderDeliveryResponseSchema,
  sellerOrderListResponseSchema,
  sellerOrderResponseSchema,
  sellerOrderSummaryResponseSchema,
  sellerOrderTransitionResponseSchema,
  shipmentResponseSchema,
} from '@shopping/shared'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import {
  createAddress,
  createCategory,
  createProduct,
  createProductVariant,
  createSeller,
  createUser,
} from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callers } from '../support/principal.js'
import { recordStatements } from '../support/statements.js'

/**
 * 판매자 콘솔의 주문 목록·뱃지·배송완료 처리 (TASK-0060), 이 워커의 실제 데이터베이스에 대고.
 *
 * 이 파일이 지키는 것이 셋이다.
 *
 * ① **목록은 내 가게의 것만 보여 준다** (F1). 소유의 축이 `SellerOrder.sellerId` 라
 *    같은 주문에 남의 몫이 섞여 있어도 내 줄만 나온다.
 * ② **커서가 건너뛰지도 겹치지도 않는다** (F7). 그리고 그것을 재는 방법은 「두 페이지를
 *    봤다」가 아니라 **끝까지 넘겨 모은 id 집합이 전체와 같다**이다 — 앞의 것은 규약이
 *    틀려도 통과한다.
 * ③ **「배송완료 처리」가 두 표를 함께 옮긴다** (4.3). TASK-0061 4.4 가 넘긴 항목이고,
 *    전이 라우트로 같은 일을 하면 주문만 움직이고 배송은 그대로 남는다 — 그 어긋남을
 *    **직접 재는** 검사가 아래에 있다.
 */

const db = useDatabase()

const statements: string[] = []

const observable = new PrismaClient({
  adapter: new PrismaPg({ connectionString: db.url, max: 5 }),
  log: [{ emit: 'event', level: 'query' }],
})

;(
  observable as unknown as {
    $on: (event: 'query', listener: (payload: { query: string }) => void) => void
  }
).$on('query', (payload) => statements.push(payload.query))

const api = useApiApp({ database: db, authenticate: true, prisma: observable })

afterAll(async () => {
  await observable.$disconnect()
})

/** A1. 로컬 부하 측정 p95. */
const P95_BUDGET_MS = 300

const SAMPLES = 20

/** 표본 루프 전체의 예산. 실패가 「p95 초과」로 보고돼야지 타임아웃이면 안 된다. */
const SAMPLING_BUDGET_MS = 120_000

/** 목록을 여러 페이지로 만들 만큼. 100건은 이 파일에서 재는 성질에 보태는 것이 없다. */
const SEEDED_ORDERS = 25

let buyer: TestCaller
let addressId: string
let categoryId: number
let store: Store

interface Store {
  readonly sellerId: string
  readonly seller: TestCaller
  readonly variantId: string
}

function client(caller: TestCaller = buyer): ApiClient {
  return api.clientAs(caller)
}

/** 팔 수 있는 조합 하나와 그 가게의 주인. */
async function storefront(): Promise<Store> {
  const owner = await createUser(db, {})
  const seller = await createSeller(db, { userId: owner.id })
  const product = await createProduct(db, {
    sellerId: seller.id,
    categoryId,
    status: 'ACTIVE',
    minPrice: 10_000,
  })
  const variant = await createProductVariant(db, {
    productId: product.id,
    sellerId: seller.id,
    price: 10_000,
    stock: 100,
    isActive: true,
  })

  return {
    sellerId: seller.id,
    seller: { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: seller.id },
    variantId: variant.id,
  }
}

/** 진짜 주문 하나. 장바구니 → 주문. 이 몫의 id 를 돌려준다. */
async function place(target: Store = store, quantity = 1): Promise<string> {
  const cart = await client().request({
    path: '/cart/items',
    method: 'POST',
    body: { variantId: target.variantId, quantity },
    schema: cartResponseSchema,
  })
  const line = cart.groups.flatMap((group) => group.items).at(-1)

  if (line === undefined) throw new Error('담긴 줄을 찾지 못했습니다.')

  const { order } = await client().request({
    path: '/orders',
    method: 'POST',
    body: { itemIds: [line.id], addressId },
    schema: orderResponseSchema,
  })
  const sellerOrderId = order.sellerOrders.at(0)?.id

  if (sellerOrderId === undefined) throw new Error('판매자 몫을 찾지 못했습니다.')

  return sellerOrderId
}

/** 그 몫을 어느 상태에 앉힌다. 전이의 문을 지나지 않는다 — 여기서 재는 것이 읽기다. */
async function setStatus(sellerOrderId: string, status: OrderStatus): Promise<void> {
  await db.execute(`UPDATE "SellerOrder" SET "status" = $2::"SellerOrderStatus" WHERE "id" = $1`, [
    sellerOrderId,
    status,
  ])
}

/**
 * 정렬 위치가 정해진 uuid.
 *
 * 커서는 `id` 위의 위치이고 `id` 는 UUIDv7 이라 시간순이다. 씨앗 데이터를 그 순서로
 * 만들어야 「몇 번째 페이지에 무엇이 있어야 하는가」를 검사가 알 수 있다.
 */
function orderedId(index: number): string {
  return `01930000-0000-7000-8000-${index.toString(16).padStart(12, '0')}`
}

/**
 * 페이지를 여러 장 만들 만큼의 몫을, SQL 로 곧장.
 *
 * 장바구니를 25번 지나가지 않는 이유는 이 검사가 재는 것이 **커서**이기 때문이다.
 * 주문이 어떻게 만들어지는지는 `orders.integration.spec.ts` 가 재고, 여기서 필요한
 * 것은 정렬 가능한 id 를 가진 줄 스물다섯이다. 항목을 달지 않는 것도 같은 이유이고,
 * 그 덕에 「항목이 없는 몫」에서도 목록이 답한다는 사실이 덤으로 잰다.
 */
async function seedOrders(count: number, status: OrderStatus = 'PAID'): Promise<string[]> {
  const ids: string[] = []

  for (let index = 1; index <= count; index += 1) {
    const orderId = orderedId(index)
    const sellerOrderId = orderedId(1000 + index)

    await db.execute(
      `INSERT INTO "Order"
         ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
          "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, '홍길동', '010-0000-0000', '06234', '서울시 강남구',
               10000, 10000, ($5::timestamptz AT TIME ZONE 'UTC'), now())`,
      [
        orderId,
        `20260906-${String(index).padStart(8, '0')}`,
        buyer.userId,
        randomUUID(),
        // `createdAt` 은 timestamp **without** time zone 이고 Prisma 는 거기에 UTC 를
        // 적는다. JS `Date` 를 그대로 넘기면 pg 가 프로세스의 지역시로 직렬화하고,
        // Postgres 는 그 오프셋을 **버리고** 저장한다 — 기간 필터가 아홉 시간 어긋난다.
        new Date(Date.UTC(2026, 8, index)).toISOString(),
      ],
    )
    await db.execute(
      `INSERT INTO "SellerOrder"
         ("id", "orderId", "sellerId", "status", "brandName", "productAmount", "paidAmount", "updatedAt")
       VALUES ($1, $2, $3, $4::"SellerOrderStatus", '가상브랜드', 10000, 10000, now())`,
      [sellerOrderId, orderId, store.sellerId, status],
    )
    ids.push(sellerOrderId)
  }

  return ids
}

/** 커서를 끝까지 따라가며 모은 전부. 「중복·누락 0건」은 이 집합으로만 답할 수 있다. */
async function walk(query = '', limit = 4): Promise<SellerOrderListItem[]> {
  const collected: SellerOrderListItem[] = []
  let cursor: string | null = null
  let pages = 0

  do {
    const separator = query === '' ? '?' : `${query}&`
    // 타입을 적어 두는 것은 취향이 아니다. `cursor` 를 다시 대입하는 고리 안에서
    // 추론이 순환해 `any` 가 되고, 그러면 아래 두 줄이 아무것도 검사하지 않는다.
    const page: SellerOrderListResponse = await client(store.seller).request({
      path: `/seller-orders${separator}limit=${String(limit)}${
        cursor === null ? '' : `&cursor=${cursor}`
      }`,
      schema: sellerOrderListResponseSchema,
    })

    collected.push(...page.sellerOrders)
    cursor = page.nextCursor
    pages += 1

    // 끝나지 않는 목록은 실패로 끝나야 한다. 무한 루프는 타임아웃으로 나타나고,
    // 그때 실패 메시지는 커서와 아무 상관이 없어 보인다.
    if (pages > 100) throw new Error('커서가 끝나지 않습니다.')
  } while (cursor !== null)

  return collected
}

beforeEach(async () => {
  buyer = { userId: (await createUser(db, {})).id, roles: ['BUYER'] }
  addressId = (await createAddress(db, { userId: buyer.userId, isDefault: true })).id
  categoryId = (await createCategory(db, { name: '아우터' })).id
  store = await storefront()
})

describe('GET /seller-orders — 내 가게의 몫만 (F1)', () => {
  it('lists the shares of the calling store', async () => {
    const sellerOrderId = await place()
    const page = await client(store.seller).request({
      path: '/seller-orders',
      schema: sellerOrderListResponseSchema,
    })

    expect(page.sellerOrders.map((row) => row.id)).toEqual([sellerOrderId])
  })

  it('never shows another store its neighbour’s share', async () => {
    await place()

    const other = await storefront()
    const page = await client(other.seller).request({
      path: '/seller-orders',
      schema: sellerOrderListResponseSchema,
    })

    expect(page.sellerOrders).toEqual([])
  })

  it('refuses a caller with no store of their own (A3)', async () => {
    // 퍼미션은 있는데 **그것을 걸 스토어가 없다.** 운영자가 콘솔 라우트를 부르면
    // 정확히 거기 있고, 「전체 판매자의 주문」은 이 라우트의 답이 아니다.
    const refusal = await client(callers.operator)
      .request({ path: '/seller-orders', schema: sellerOrderListResponseSchema })
      .catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(ApiClientError)
    expect((refusal as ApiClientError).status).toBe(403)
  })

  it('refuses an anonymous caller (A4)', async () => {
    const refusal = await api.client
      .request({ path: '/seller-orders', schema: sellerOrderListResponseSchema })
      .catch((error: unknown) => error)

    expect((refusal as ApiClientError).status).toBe(401)
  })
})

describe('GET /seller-orders — 필터 (F2)', () => {
  it('narrows to one status', async () => {
    const paid = await place()
    const preparing = await place()

    await setStatus(paid, 'PAID')
    await setStatus(preparing, 'PREPARING')

    const page = await client(store.seller).request({
      path: '/seller-orders?status=PAID',
      schema: sellerOrderListResponseSchema,
    })

    expect(page.sellerOrders.map((row) => row.id)).toEqual([paid])
  })

  it('takes several statuses, because a tab can mean two (취소·반품)', async () => {
    const canceled = await place()
    const returned = await place()
    const shipped = await place()

    await setStatus(canceled, 'CANCELED')
    await setStatus(returned, 'RETURNED')
    await setStatus(shipped, 'SHIPPED')

    const page = await client(store.seller).request({
      path: '/seller-orders?status=CANCELED,RETURNED',
      schema: sellerOrderListResponseSchema,
    })

    expect(page.sellerOrders.map((row) => row.id).sort()).toEqual([canceled, returned].sort())
  })

  it('refuses a status nobody defined (A2)', async () => {
    const refusal = await client(store.seller)
      .request({ path: '/seller-orders?status=NOPE', schema: sellerOrderListResponseSchema })
      .catch((error: unknown) => error)

    expect((refusal as ApiClientError).status).toBe(400)
  })

  it('bounds the period by 접수 시각', async () => {
    await seedOrders(5)

    const page = await client(store.seller).request({
      path: '/seller-orders?from=2026-09-02T00:00:00.000Z&to=2026-09-04T00:00:00.000Z',
      schema: sellerOrderListResponseSchema,
    })

    // 씨앗은 9월 1일부터 하루에 하나씩이다. 경계는 양쪽 다 포함이다.
    expect(page.sellerOrders).toHaveLength(3)
  })

  it('searches the order number', async () => {
    await seedOrders(3)

    const page = await client(store.seller).request({
      path: '/seller-orders?q=00000002',
      schema: sellerOrderListResponseSchema,
    })

    expect(page.sellerOrders.map((row) => row.orderNumber)).toEqual(['20260906-00000002'])
  })

  it('searches the recipient name — the seller answers the phone with it', async () => {
    await seedOrders(2)

    const page = await client(store.seller).request({
      path: '/seller-orders?q=홍길동',
      schema: sellerOrderListResponseSchema,
    })

    expect(page.sellerOrders).toHaveLength(2)
  })

  it('treats a wildcard as a character, not as a wildcard', async () => {
    // 이스케이프가 빠지면 `%` 하나가 전체 목록을 뜻하게 되고, 그때 검색은 아무 일도
    // 하지 않으면서 정상으로 보인다.
    await seedOrders(3)

    const page = await client(store.seller).request({
      path: '/seller-orders?q=%25',
      schema: sellerOrderListResponseSchema,
    })

    expect(page.sellerOrders).toEqual([])
  })
})

describe('GET /seller-orders — 커서 (F7)', () => {
  it('walks the whole list with no duplicate and no gap', async () => {
    const seeded = await seedOrders(SEEDED_ORDERS)
    const walked = await walk()

    expect(walked).toHaveLength(seeded.length)
    expect(new Set(walked.map((row) => row.id)).size).toBe(seeded.length)
    expect(walked.map((row) => row.id).sort()).toEqual([...seeded].sort())
  })

  it('answers newest first', async () => {
    const seeded = await seedOrders(5)
    const page = await client(store.seller).request({
      path: '/seller-orders',
      schema: sellerOrderListResponseSchema,
    })

    expect(page.sellerOrders.map((row) => row.id)).toEqual([...seeded].reverse())
  })

  it('ends with a null cursor rather than an empty page forever', async () => {
    await seedOrders(3)

    const page = await client(store.seller).request({
      path: '/seller-orders?limit=50',
      schema: sellerOrderListResponseSchema,
    })

    expect(page.nextCursor).toBeNull()
  })

  it('keeps the filter while paging', async () => {
    await seedOrders(6, 'PAID')
    const shipped = await seedOrders(0)

    expect(shipped).toEqual([])

    const walked = await walk('?status=PAID', 2)

    expect(walked).toHaveLength(6)
  })
})

describe('GET /seller-orders — 개인정보 (F6)', () => {
  it('masks the recipient name and sends the original nowhere', async () => {
    await place()

    const page = await client(store.seller).request({
      path: '/seller-orders',
      schema: sellerOrderListResponseSchema,
    })
    const row = page.sellerOrders.at(0)

    expect(row?.maskedRecipientName).toBe('수*인')
    // **응답 본문 어디에도** 원본이 없어야 뜻이 있다. 필드 하나를 가리고 옆 필드로
    // 흘려보내는 구현도 위의 단언은 통과한다.
    expect(JSON.stringify(page)).not.toContain('수령인')
  })

  it('carries no phone number in the list at all', async () => {
    await place()

    const page = await client(store.seller).request({
      path: '/seller-orders',
      schema: sellerOrderListResponseSchema,
    })

    expect(JSON.stringify(page)).not.toContain('010-0000-0000')
  })

  it('still gives the full recipient on the detail — the seller must ship to it', async () => {
    const sellerOrderId = await place()
    const detail = await client(store.seller).request({
      path: `/seller-orders/${sellerOrderId}`,
      schema: sellerOrderResponseSchema,
    })

    expect(detail.recipient.name).toBe('수령인')
    expect(detail.recipient.phone).toBe('010-0000-0000')
  })
})

describe('GET /seller-orders/summary — 뱃지 (2장)', () => {
  it('counts every status, zeros included', async () => {
    await place()

    const { summary } = await client(store.seller).request({
      path: '/seller-orders/summary',
      schema: sellerOrderSummaryResponseSchema,
    })

    expect(summary.counts.PAYMENT_PENDING).toBe(1)
    expect(summary.counts.DELIVERED).toBe(0)
  })

  it('is not shadowed by /seller-orders/:id', async () => {
    // 라우터는 먼저 선언된 것을 쓴다. `summary` 가 `:id` 아래로 내려가면 그 문자열이
    // uuid 로 읽혀 조회가 500 으로 끝나고, 증상은 「뱃지가 안 보인다」다.
    const answer = await client(store.seller).request({
      path: '/seller-orders/summary',
      schema: sellerOrderSummaryResponseSchema,
    })

    expect(answer.summary).toBeDefined()
  })

  it('names 처리 대기 as the seller’s own queue', async () => {
    const paid = await place()
    const preparing = await place()
    const shipped = await place()

    await setStatus(paid, 'PAID')
    await setStatus(preparing, 'PREPARING')
    await setStatus(shipped, 'SHIPPED')

    const { summary } = await client(store.seller).request({
      path: '/seller-orders/summary',
      schema: sellerOrderSummaryResponseSchema,
    })

    expect(summary.newOrders).toBe(1)
    expect(summary.actionRequired).toBe(2)
  })

  it('counts only the calling store', async () => {
    await place()

    const other = await storefront()
    const { summary } = await client(other.seller).request({
      path: '/seller-orders/summary',
      schema: sellerOrderSummaryResponseSchema,
    })

    expect(summary.actionRequired).toBe(0)
    expect(summary.counts.PAYMENT_PENDING).toBe(0)
  })

  it('does not move when the list is filtered — that is what makes it a badge', async () => {
    await seedOrders(4, 'PAID')

    const filtered = await client(store.seller).request({
      path: '/seller-orders?status=SHIPPED',
      schema: sellerOrderListResponseSchema,
    })
    const { summary } = await client(store.seller).request({
      path: '/seller-orders/summary',
      schema: sellerOrderSummaryResponseSchema,
    })

    expect(filtered.sellerOrders).toEqual([])
    expect(summary.actionRequired).toBe(4)
  })
})

describe('GET /seller-orders/:id — 상태 이력 (TASK-0060)', () => {
  it('carries the history the state machine writes', async () => {
    const sellerOrderId = await place()

    await setStatus(sellerOrderId, 'PAID')
    await client(store.seller).request({
      path: `/seller-orders/${sellerOrderId}/transitions`,
      method: 'POST',
      body: { to: 'PREPARING' },
      schema: sellerOrderTransitionResponseSchema,
    })

    const detail = await client(store.seller).request({
      path: `/seller-orders/${sellerOrderId}`,
      schema: sellerOrderResponseSchema,
    })
    const last = detail.sellerOrder.history.at(-1)

    expect(last?.toStatus).toBe('PREPARING')
    // **누가** 옮겼는지가 이 줄의 값이다. 분쟁에서 근거가 되는 것이 그것이고,
    // 지금까지 이 표를 읽는 자리가 없었다.
    expect(last?.actor).toBe('SELLER')
  })

  it('carries no actor id — the console can do nothing with one', async () => {
    const sellerOrderId = await place()
    const detail = await client(store.seller).request({
      path: `/seller-orders/${sellerOrderId}`,
      schema: sellerOrderResponseSchema,
    })

    expect(JSON.stringify(detail)).not.toContain(store.seller.userId)
  })
})

describe('가능 액션이 화면에 말하는 것 (F5)', () => {
  /**
   * **`PREPARING → SHIPPED` 는 언제나 「조건이 모자라다」로 온다.**
   *
   * 전이의 문이 운송장을 요구하고 발송 전에는 그것이 없기 때문이다. 그런데 운송장을
   * 만드는 것이 발송 라우트라, 화면이 이 답을 그대로 믿고 버튼을 잠그면 판매자는
   * 영영 발송할 수 없다 — 콘솔의 `isPressable` 이 그 자리를 메우고, **그 규칙이
   * 기대는 사실이 이것**이다. 여기가 언젠가 `enabled: true` 로 바뀌면 그쪽 예외도
   * 함께 없어져야 한다.
   */
  it('blocks 발송 on the transition door, with the requirement named', async () => {
    const sellerOrderId = await place()

    await setStatus(sellerOrderId, 'PREPARING')

    const answer = await client(store.seller).request({
      path: `/seller-orders/${sellerOrderId}/actions`,
      schema: sellerOrderActionsResponseSchema,
    })
    const ship = answer.actions.find((action) => action.to === 'SHIPPED')

    expect(ship?.enabled).toBe(false)
    expect(ship?.blockedBy).toBe('tracking')
  })

  it('offers 배송완료 to the seller once the share has shipped', async () => {
    const sellerOrderId = await place()

    await setStatus(sellerOrderId, 'SHIPPED')

    const answer = await client(store.seller).request({
      path: `/seller-orders/${sellerOrderId}/actions`,
      schema: sellerOrderActionsResponseSchema,
    })

    // 설계서 1장: 시뮬레이터가 멈춘 데모에서 판매자가 흐름을 이어 갈 수 있어야 한다.
    // 그 버튼이 여기 없으면 콘솔은 그것을 그릴 근거가 없다.
    expect(answer.actions.map((action) => action.to)).toContain('DELIVERED')
  })
})

describe('POST /seller-orders/:id/delivery — 배송완료 처리 (4.3)', () => {
  /** 발송까지 끝난 몫 하나. 운송장·첫 사건·`SHIPPED` 가 함께 있다. */
  async function shipped(): Promise<string> {
    const sellerOrderId = await place()

    // 결제는 `SYSTEM` 만 일으킨다 (전이표). 이 파일이 재는 것은 그 뒤이므로 결제
    // 자체는 지나가고, 판매자가 실제로 누르는 두 걸음만 문을 지난다.
    await setStatus(sellerOrderId, 'PAID')
    await client(store.seller).request({
      path: `/seller-orders/${sellerOrderId}/transitions`,
      method: 'POST',
      body: { to: 'PREPARING' },
      schema: sellerOrderTransitionResponseSchema,
    })
    await client(store.seller).request({
      path: `/seller-orders/${sellerOrderId}/shipment`,
      method: 'POST',
      body: {},
      schema: shipmentResponseSchema,
    })

    return sellerOrderId
  }

  it('moves the order and the shipment together', async () => {
    const sellerOrderId = await shipped()
    const answer = await client(store.seller).request({
      path: `/seller-orders/${sellerOrderId}/delivery`,
      method: 'POST',
      schema: sellerOrderDeliveryResponseSchema,
    })

    expect(answer.transition.status).toBe('DELIVERED')
    expect(answer.transition.changed).toBe(true)
    expect(answer.shipment.status).toBe('DELIVERED')
    expect(answer.shipment.deliveredAt).not.toBeNull()
  })

  /**
   * **이 검사가 TASK-0061 4.4 의 문제를 직접 잰다.**
   *
   * 전이 라우트로 같은 일을 하면 주문만 `DELIVERED` 가 되고 배송은 그대로 남는다 —
   * 구매자의 추적 화면이 「이동 중」인 채로 주문은 배송완료다. 그 어긋남이 실재한다는
   * 것을 재고, 바로 아래에서 새 라우트가 그것을 만들지 않는다는 것을 잰다. 앞의 절반이
   * 없으면 뒤의 절반은 「원래 안 깨지는 것」을 재는 검사가 된다.
   */
  it('is the difference the transition route does not make', async () => {
    const viaTransition = await shipped()

    await client(store.seller).request({
      path: `/seller-orders/${viaTransition}/transitions`,
      method: 'POST',
      body: { to: 'DELIVERED' },
      schema: sellerOrderTransitionResponseSchema,
    })

    const stale = await client(store.seller).request({
      path: `/seller-orders/${viaTransition}/shipment`,
      schema: shipmentResponseSchema,
    })

    expect(stale.shipment.status).not.toBe('DELIVERED')

    const viaDelivery = await shipped()

    await client(store.seller).request({
      path: `/seller-orders/${viaDelivery}/delivery`,
      method: 'POST',
      schema: sellerOrderDeliveryResponseSchema,
    })

    const fresh = await client(store.seller).request({
      path: `/seller-orders/${viaDelivery}/shipment`,
      schema: shipmentResponseSchema,
    })

    expect(fresh.shipment.status).toBe('DELIVERED')
  })

  it('leaves a tracking line that says a person confirmed it', async () => {
    const sellerOrderId = await shipped()
    const answer = await client(store.seller).request({
      path: `/seller-orders/${sellerOrderId}/delivery`,
      method: 'POST',
      schema: sellerOrderDeliveryResponseSchema,
    })
    const last = answer.shipment.events.at(-1)

    expect(last?.kind).toBe('DELIVERED')
    // 운송사가 보고한 것처럼 적으면 이력이 거짓이 된다 — TASK-0061 이 추적 사건
    // 기록을 HTTP 로 열지 않은 이유가 그것이고, 이 라우트는 그 판단을 지킨다.
    expect(last?.description).toContain('판매자')
    expect(last?.location).not.toContain('터미널')
  })

  it('writes SELLER, not SYSTEM, into the order history', async () => {
    const sellerOrderId = await shipped()

    await client(store.seller).request({
      path: `/seller-orders/${sellerOrderId}/delivery`,
      method: 'POST',
      schema: sellerOrderDeliveryResponseSchema,
    })

    const detail = await client(store.seller).request({
      path: `/seller-orders/${sellerOrderId}`,
      schema: sellerOrderResponseSchema,
    })
    const delivered = detail.sellerOrder.history.filter((entry) => entry.toStatus === 'DELIVERED')

    expect(delivered).toHaveLength(1)
    expect(delivered.at(0)?.actor).toBe('SELLER')
  })

  it('answers the buttons that are true after the move', async () => {
    const sellerOrderId = await shipped()
    const answer = await client(store.seller).request({
      path: `/seller-orders/${sellerOrderId}/delivery`,
      method: 'POST',
      schema: sellerOrderDeliveryResponseSchema,
    })
    const asked = await client(store.seller).request({
      path: `/seller-orders/${sellerOrderId}/actions`,
      schema: sellerOrderActionsResponseSchema,
    })

    expect(answer.transition.actions).toEqual(asked.actions)
  })

  it('is idempotent — a second press adds no second line', async () => {
    const sellerOrderId = await shipped()

    await client(store.seller).request({
      path: `/seller-orders/${sellerOrderId}/delivery`,
      method: 'POST',
      schema: sellerOrderDeliveryResponseSchema,
    })
    const again = await client(store.seller).request({
      path: `/seller-orders/${sellerOrderId}/delivery`,
      method: 'POST',
      schema: sellerOrderDeliveryResponseSchema,
    })

    expect(again.transition.changed).toBe(false)
    expect(again.shipment.events.filter((event) => event.kind === 'DELIVERED')).toHaveLength(1)
  })

  it('refuses a share that was never shipped, and leaves nothing behind', async () => {
    const sellerOrderId = await place()
    const refusal = await client(store.seller)
      .request({
        path: `/seller-orders/${sellerOrderId}/delivery`,
        method: 'POST',
        schema: sellerOrderDeliveryResponseSchema,
      })
      .catch((error: unknown) => error)

    expect((refusal as ApiClientError).status).toBe(404)

    const rows = await db.query(`SELECT count(*)::int AS "count" FROM "ShipmentTrackingEvent"`, [])

    expect(rows.at(0)?.count).toBe(0)
  })

  it('refuses another store (A3)', async () => {
    const sellerOrderId = await shipped()
    const other = await storefront()
    const refusal = await client(other.seller)
      .request({
        path: `/seller-orders/${sellerOrderId}/delivery`,
        method: 'POST',
        schema: sellerOrderDeliveryResponseSchema,
      })
      .catch((error: unknown) => error)

    expect((refusal as ApiClientError).status).toBe(403)
  })

  it('refuses an anonymous caller (A4)', async () => {
    const sellerOrderId = await shipped()
    const refusal = await api.client
      .request({
        path: `/seller-orders/${sellerOrderId}/delivery`,
        method: 'POST',
        schema: sellerOrderDeliveryResponseSchema,
      })
      .catch((error: unknown) => error)

    expect((refusal as ApiClientError).status).toBe(401)
  })
})

describe('목록의 비용 (A1 · A5 · F8)', () => {
  it(
    'lists five shares in the same number of statements as one',
    async () => {
      await seedOrders(1)

      const forOne = await recordStatements(statements, () =>
        client(store.seller).request({
          path: '/seller-orders',
          schema: sellerOrderListResponseSchema,
        }),
      )

      await db.execute(`DELETE FROM "Order"`, [])
      await seedOrders(5)

      const forFive = await recordStatements(statements, () =>
        client(store.seller).request({
          path: '/seller-orders',
          schema: sellerOrderListResponseSchema,
        }),
      )

      // 줄마다 항목을 따로 읽으면 여기서 넷이 는다. 그 회귀는 기능 검사를 하나도
      // 빨갛게 만들지 않고, 화면에서도 보이지 않는다.
      expect(forFive.length).toBe(forOne.length)
    },
    SAMPLING_BUDGET_MS,
  )

  it(
    'answers a page inside the budget (A1)',
    async () => {
      await seedOrders(SEEDED_ORDERS)

      const durations: number[] = []

      for (let sample = 0; sample < SAMPLES; sample += 1) {
        const started = performance.now()

        await client(store.seller).request({
          path: '/seller-orders?limit=20',
          schema: sellerOrderListResponseSchema,
        })
        durations.push(performance.now() - started)
      }

      durations.sort((left, right) => left - right)

      const p95 = durations.at(Math.floor(durations.length * 0.95) - 1) ?? Infinity

      expect(p95).toBeLessThanOrEqual(P95_BUDGET_MS)
    },
    SAMPLING_BUDGET_MS,
  )
})
