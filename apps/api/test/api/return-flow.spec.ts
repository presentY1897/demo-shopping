import type { ApiClient, ClaimStatus, ReturnReason, ReturnResponse } from '@shopping/shared'
import {
  ApiClientError,
  cartResponseSchema,
  claimResponseSchema,
  claimTransitionResponseSchema,
  orderResponseSchema,
  RETURN_PHOTO_MAX_COUNT,
  returnResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { PrismaService } from '../../src/prisma/prisma.service.js'

import type { ReturnCompleted } from '../../src/claims/return-events.js'
import { RETURN_REFUND_EVENTS, RETURN_RESTOCK_EVENTS } from '../../src/claims/return-events.js'
import type { AppConfig } from '../../src/config/app-config.js'
import { APP_CONFIG } from '../../src/config/app-config.js'
import { autoConfirmWindowMs } from '../../src/orders/order-confirm.js'
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

/**
 * 반품 — 신청의 부속 · 수거 · 검수 (TASK-0067), 이 워커의 실제 데이터베이스에 대고.
 *
 * 규칙 표가 옳은지는 `src/claims/return-rules.spec.ts` 가 순수 함수로 잰다. **여기서
 * 재는 것은 그 표가 행에 실제로 적용되는가**이고, 그중 값이 가장 큰 것 하나가
 * **「합격일 때만 환불이 불린다」**다. 그 단언은 대역이 없으면 쓸 수 없다 — 환불은
 * TASK-0068 이고 지금 바인딩된 구현은 아무것도 하지 않아서, 「불렸는가」를 물을
 * 대상이 존재하지 않기 때문이다. 그래서 포트 둘을 받아 적는 대역으로 바꾼다.
 *
 * 마지막 방어선(제약)은 애플리케이션을 지나지 않고 **날 SQL 로** 위반해 본다
 * (QUALITY-GATES S5).
 */

const db = useDatabase()

/** 검수를 통과한 반품이 넘어가는 자리. 두 포트를 따로 적는다 — 둘은 다른 일이다. */
const refunded: ReturnCompleted[] = []
const restocked: ReturnCompleted[] = []

const api = useApiApp({
  database: db,
  authenticate: true,
  overrides: [
    {
      token: RETURN_REFUND_EVENTS,
      value: {
        refund(events: readonly ReturnCompleted[]) {
          refunded.push(...events)

          return Promise.resolve()
        },
      },
    },
    {
      token: RETURN_RESTOCK_EVENTS,
      value: {
        restock(events: readonly ReturnCompleted[]) {
          restocked.push(...events)

          return Promise.resolve()
        },
      },
    },
  ],
})

/** 이 스펙이 서는 시각. 반품 기간의 안팎을 여기서부터 잰다. */
const NOW = '2026-09-03T00:00:00.000Z'

/** 반품 기간 — 자동 구매확정과 **같은 축**에서, 이 앱이 실제로 쓰는 설정으로. */
function returnWindowMs(): number {
  return autoConfirmWindowMs(api.resolve<AppConfig>(APP_CONFIG).fulfillmentPace)
}

interface PlacedItem {
  readonly id: string
  readonly quantity: number
}

interface Placed {
  readonly sellerOrderId: string
  readonly items: readonly PlacedItem[]
  readonly seller: TestCaller
  readonly sellerId: string
}

let buyer: TestCaller
let addressId: string
let categoryId: number
let placed: Placed

function client(caller: TestCaller = buyer): ApiClient {
  return api.clientAs(caller)
}

/** 팔 수 있는 조합 둘과 그 가게의 주인. 둘이 **한 판매자**여야 한 몫에 들어온다. */
async function storefront(prices: readonly number[]) {
  const owner = await createUser(db, {})
  const seller = await createSeller(db, { userId: owner.id })
  const variants: string[] = []

  for (const price of prices) {
    const product = await createProduct(db, {
      sellerId: seller.id,
      categoryId,
      status: 'ACTIVE',
      minPrice: price,
    })
    const variant = await createProductVariant(db, {
      productId: product.id,
      sellerId: seller.id,
      price,
      stock: 20,
      isActive: true,
    })

    variants.push(variant.id)
  }

  return {
    variantIds: variants,
    sellerId: seller.id,
    seller: { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: seller.id } satisfies TestCaller,
  }
}

/** 진짜 주문 하나 — 항목 2개, 수량 1 · 2. */
async function place(): Promise<Placed> {
  const store = await storefront([10_000, 20_000])
  const itemIds: string[] = []

  for (const [index, variantId] of store.variantIds.entries()) {
    const cart = await client().request({
      path: '/cart/items',
      method: 'POST',
      body: { variantId, quantity: index + 1 },
      schema: cartResponseSchema,
    })
    const line = cart.groups
      .flatMap((group) => group.items)
      .find((item) => item.variantId === variantId)

    if (line === undefined) throw new Error('담긴 줄을 찾지 못했습니다.')

    itemIds.push(line.id)
  }

  const { order } = await client().request({
    path: '/orders',
    method: 'POST',
    body: { itemIds, addressId },
    schema: orderResponseSchema,
  })
  const sellerOrder = order.sellerOrders.at(0)

  if (sellerOrder === undefined) throw new Error('판매자 몫을 찾지 못했습니다.')

  return {
    sellerOrderId: sellerOrder.id,
    items: [...sellerOrder.items]
      .map((item) => ({ id: item.id, quantity: item.quantity }))
      .sort((left, right) => left.quantity - right.quantity),
    seller: store.seller,
    sellerId: store.sellerId,
  }
}

/**
 * 배송완료로 두고 **기간 안**에 세운다.
 *
 * `deliveredAt` 을 상태 이력으로 심는 것이 요점이다 — 반품 기간이 그것을 읽고 배송
 * 표는 읽지 않는다 (TASK-0064 4.1).
 */
async function deliver(): Promise<void> {
  await db.query(
    `UPDATE "SellerOrder" SET "status" = 'DELIVERED'::"SellerOrderStatus" WHERE "id" = $1`,
    [placed.sellerOrderId],
  )
  await db.query(
    `INSERT INTO "OrderStatusHistory"
       ("id", "sellerOrderId", "fromStatus", "toStatus", "actor", "actorId", "createdAt")
     VALUES (gen_random_uuid(), $1, 'SHIPPED', 'DELIVERED', 'SYSTEM', NULL,
             ($2::timestamptz AT TIME ZONE 'UTC'))`,
    [placed.sellerOrderId, new Date(Date.parse(NOW) - Math.floor(returnWindowMs() / 2))],
  )
}

/** 이 사람의 열쇠 하나. 접두어가 사람인 것이 소유 판정의 전부다. */
function photoKey(owner: string, index: number): string {
  return `returns/${owner}/0000000${index}-0000-4000-8000-000000000000.jpg`
}

/** 이 구매자의 서로 다른 열쇠 `count` 장. 상한의 안팎을 여기서 만든다. */
function photoKeys(count: number): readonly string[] {
  return Array.from({ length: count }, (_unused, index) => photoKey(buyer.userId, index + 1))
}

interface RequestOptions {
  readonly returnReason?: ReturnReason
  readonly photoKeys?: readonly string[]
  readonly caller?: TestCaller
  readonly quantity?: number
}

function requestReturn(options: RequestOptions = {}): Promise<ReturnResponse> {
  const reason = options.returnReason ?? 'DEFECTIVE'
  const target = placed.items[0]

  if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

  return client(options.caller ?? buyer).request({
    path: '/returns',
    method: 'POST',
    body: {
      sellerOrderId: placed.sellerOrderId,
      items: [{ orderItemId: target.id, quantity: options.quantity ?? 1 }],
      reason: '받아 보니 박음질이 터져 있어요.',
      // **사유와 사진이 한 객체다.** 따로 두면 「사유 없는 사진」이 표현 가능해지고,
      // 그것은 무엇의 증거인지 아무도 말할 수 없는 이미지다.
      return: {
        returnReason: reason,
        photoKeys:
          options.photoKeys ??
          (reason === 'CHANGE_OF_MIND' ? [] : [photoKey((options.caller ?? buyer).userId, 1)]),
      },
    },
    schema: returnResponseSchema,
  })
}

function approve(claimId: string, caller: TestCaller = placed.seller) {
  return client(caller).request({
    path: `/claims/${claimId}/transitions`,
    method: 'POST',
    body: { to: 'RETURN_APPROVED' },
    schema: claimTransitionResponseSchema,
  })
}

function moveClaim(claimId: string, to: ClaimStatus, caller: TestCaller = placed.seller) {
  return client(caller).request({
    path: `/claims/${claimId}/transitions`,
    method: 'POST',
    body: { to },
    schema: claimTransitionResponseSchema,
  })
}

function pickUp(claimId: string, caller: TestCaller = placed.seller): Promise<ReturnResponse> {
  return client(caller).request({
    path: `/returns/${claimId}/pickup`,
    method: 'POST',
    body: {},
    schema: returnResponseSchema,
  })
}

function inspect(
  claimId: string,
  passed: boolean,
  caller: TestCaller = placed.seller,
): Promise<ReturnResponse> {
  return client(caller).request({
    path: `/returns/${claimId}/inspection`,
    method: 'POST',
    body: { passed, note: passed ? null : '사용감이 뚜렷해요.' },
    schema: returnResponseSchema,
  })
}

/** 승인 → 수거 → 입고까지. 검수 앞에 세우는 것이 이 함수의 전부다. */
async function upToInspecting(options: RequestOptions = {}): Promise<string> {
  const { claim } = await requestReturn(options)

  await approve(claim.id)
  await pickUp(claim.id)
  await moveClaim(claim.id, 'INSPECTING')

  return claim.id
}

interface HttpFailure {
  readonly status: number
  readonly code: string
  readonly message: string
  /** 어느 칸이 문제인가. 사진 거절 다섯이 전부 같은 칸을 가리킨다. */
  readonly field: string
  /** 화면이 문장을 다시 쓸 때 쓰는 값. 상한 거절만 이것을 달고 나간다. */
  readonly params: Readonly<Record<string, unknown>>
}

function failureOf(error: unknown): HttpFailure {
  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  const detail = error.body?.error.details?.at(0)
  const entry = typeof detail === 'object' && detail !== null ? detail : {}

  return {
    status: error.status ?? 0,
    code: error.body?.error.code ?? '',
    message: 'message' in entry ? String(entry.message) : (error.body?.error.message ?? ''),
    field: 'field' in entry && typeof entry.field === 'string' ? entry.field : '',
    params: 'params' in entry ? ((entry.params ?? {}) as Record<string, unknown>) : {},
  }
}

async function failure(work: Promise<unknown>): Promise<HttpFailure> {
  return failureOf(
    await work.then(
      () => null,
      (reason: unknown) => reason,
    ),
  )
}

function statusOf(claimId: string): Promise<{ status: string }> {
  return db.one(`SELECT "status"::text AS "status" FROM "ClaimRequest" WHERE "id" = $1`, [claimId])
}

beforeEach(async () => {
  api.clock.set(NOW)
  refunded.length = 0
  restocked.length = 0

  const account = await createUser(db, {})

  buyer = { userId: account.id, roles: ['BUYER'] }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db, {})).id
  placed = await place()
  await deliver()
})

describe('F6 — 귀책 셋이 저마다 부담을 낸다', () => {
  /**
   * **행에 실제로 굳는지를 잰다.** 순수 함수가 옳다는 것은 옆 파일이 이미 재고,
   * 여기서 물을 것은 그 답이 신청 시점에 `ReturnDetail` 로 복사되는가다 — 복사되지
   * 않으면 판매자가 배송비 정책을 바꾼 날 이미 신청된 반품의 부담액이 따라 움직인다.
   */
  it('단순 변심은 구매자가 반품비를 물고 원 배송비를 돌려받지 못한다', async () => {
    const { claim, return: detail } = await requestReturn({ returnReason: 'CHANGE_OF_MIND' })
    const seller = await db.one<{ shippingFee: number }>(
      `SELECT "shippingFee" FROM "Seller" WHERE "id" = $1`,
      [placed.sellerId],
    )

    expect(claim.type).toBe('RETURN')
    expect(claim.fault).toBe('CUSTOMER')
    expect(detail.feeBearer).toBe('BUYER')
    // 반품비의 출처는 **판매자의 정책값**이다. 주문에 실제로 부과된 배송비가
    // 아니라는 것이 이 TASK 의 판단이고, 그 근거는 `return.service.ts` 에 있다.
    expect(detail.returnShippingFee).toBe(seller.shippingFee)
    expect(detail.returnShippingDeduction).toBe(seller.shippingFee)
    expect(detail.originalShippingRefund).toBe(0)
  })

  it('상품 하자는 판매자가 물고 원 배송비를 돌려준다', async () => {
    const { claim, return: detail } = await requestReturn({ returnReason: 'DEFECTIVE' })
    const order = await db.one<{ shippingFee: number }>(
      `SELECT "shippingFee" FROM "SellerOrder" WHERE "id" = $1`,
      [placed.sellerOrderId],
    )

    expect(claim.fault).toBe('SELLER')
    expect(detail.feeBearer).toBe('SELLER')
    expect(detail.returnShippingDeduction).toBe(0)
    expect(detail.originalShippingRefund).toBe(order.shippingFee)
  })

  it('오배송도 판매자 부담이다 — 하자와 돈에서만 같고 사유는 남는다', async () => {
    const { claim, return: detail } = await requestReturn({ returnReason: 'WRONG_ITEM' })

    expect(claim.fault).toBe('SELLER')
    expect(detail.feeBearer).toBe('SELLER')
    // 셋을 둘로 접지 않은 이유가 이 줄이다. `ClaimFault` 만 남기면 「무엇 때문에
    // 돌려보냈나」는 자유 서술에만 남고 아무도 셀 수 없다.
    expect(detail.reason).toBe('WRONG_ITEM')
  })

  /**
   * **귀책을 요청이 주장할 수 없다.** 계약에 `fault` 가 아예 없으므로 보내도
   * 무시되고, 저장된 값은 언제나 사유에서 파생된 것이다.
   */
  it('요청이 귀책을 주장해도 사유가 정한 값이 저장된다', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { claim } = await client().request({
      path: '/returns',
      method: 'POST',
      body: {
        sellerOrderId: placed.sellerOrderId,
        items: [{ orderItemId: target.id, quantity: 1 }],
        reason: '주문한 색이 아니에요.',
        return: { returnReason: 'WRONG_ITEM', photoKeys: [photoKey(buyer.userId, 1)] },
        fault: 'CUSTOMER',
      },
      schema: returnResponseSchema,
    })

    expect(claim.fault).toBe('SELLER')
  })
})

/**
 * F2 — 사진의 경계.
 *
 * **다섯이 저마다 다른 코드로 나간다.** 나누는 기준은 사람이 할 일이 다른가다 —
 * 찍어서 다시 올려야 하는 사람과, 사유를 고쳐야 하는 사람과, 한 장을 빼야 하는
 * 사람과, 아무것도 할 수 없는 사람에게 같은 코드로 답하면 화면은 문장을 읽고
 * 갈라야 한다. 그래서 여기서 재는 것은 상태 코드가 아니라 **코드 그 자체**다.
 */
describe('F2 — 사진의 경계', () => {
  it('사진 없는 하자 반품은 거절된다', async () => {
    const refused = await failure(requestReturn({ returnReason: 'DEFECTIVE', photoKeys: [] }))

    expect(refused.status).toBe(400)
    expect(refused.code).toBe('RETURN_PHOTO_REQUIRED')
    expect(refused.field).toBe('return.photoKeys')
  })

  it('사진 있는 단순 변심도 거절된다', async () => {
    const refused = await failure(
      requestReturn({ returnReason: 'CHANGE_OF_MIND', photoKeys: [photoKey(buyer.userId, 1)] }),
    )

    expect(refused.status).toBe(400)
    expect(refused.code).toBe('RETURN_PHOTO_NOT_ALLOWED')
    expect(refused.field).toBe('return.photoKeys')
  })

  /** 경계의 안쪽. 상한이 **규칙의** 상한이므로 이 줄과 아래 줄이 짝이다. */
  it('상한만큼은 붙일 수 있다', async () => {
    const keys = photoKeys(RETURN_PHOTO_MAX_COUNT)
    const { return: detail } = await requestReturn({ returnReason: 'DEFECTIVE', photoKeys: keys })

    expect(detail.photoKeys).toEqual(keys)
  })

  /**
   * 상한을 넘으면 **몇 장까지인지**를 함께 말한다.
   *
   * `params.max` 가 이 코드의 존재 이유다. 숫자를 문장에만 넣으면 화면이 그 문장을
   * 파싱해야 하고, 상한이 바뀌는 날 화면은 옛 숫자를 자신 있게 적는다 —
   * `CLAIM_EXCEEDS_REMAINING` 이 `params.remaining` 을 다는 것과 같은 축이다.
   *
   * **계약이 아니라 규칙이 답한다는 것도 함께 잰다.** 계약에 `.max()` 를 걸면 여섯
   * 번째 장이 `INVALID` 한 필드 오류가 되고, 그 답은 사유를 고쳐야 하는 사람과 한
   * 장을 빼면 되는 사람을 구분하지 못한다. `BAD_REQUEST` 가 아니라 이 코드가
   * 나온다는 단언이 그 구분이 살아 있다는 증거다.
   */
  it('상한을 넘긴 사진은 몇 장까지인지와 함께 거절된다', async () => {
    const keys = photoKeys(RETURN_PHOTO_MAX_COUNT + 1)
    const refused = await failure(requestReturn({ returnReason: 'DEFECTIVE', photoKeys: keys }))

    expect(refused.status).toBe(400)
    expect(refused.code).toBe('RETURN_PHOTO_TOO_MANY')
    expect(refused.field).toBe('return.photoKeys')
    // 숫자를 그대로 적는다. 상수로 비교하면 상한이 바뀌어도 초록이라 **화면이 읽는
    // 값이 실제로 몇인지**는 아무도 재지 않게 되고, 다섯은 「전체·하자 부위·가까이·
    // 라벨·포장」이라는 판단이 붙은 값이지 배포 설정이 아니다.
    expect(refused.params.max).toBe(5)
  })

  it('같은 사진을 두 번 붙이면 거절된다', async () => {
    const key = photoKey(buyer.userId, 1)
    const refused = await failure(
      requestReturn({ returnReason: 'DEFECTIVE', photoKeys: [key, key] }),
    )

    expect(refused.status).toBe(400)
    expect(refused.code).toBe('RETURN_PHOTO_DUPLICATE')
    expect(refused.field).toBe('return.photoKeys')
  })

  it('남의 열쇠는 거절된다 — 열쇠의 접두어가 소유자다', async () => {
    const stranger = await createUser(db, {})
    const refused = await failure(requestReturn({ photoKeys: [photoKey(stranger.id, 1)] }))

    expect(refused.status).toBe(400)
    // **없는 사진인지 남의 사진인지 구분해 주지 않는다.** 갈라 답하면 열쇠를 넣어
    // 보는 것만으로 그것이 존재하는지 알 수 있다.
    expect(refused.code).toBe('RETURN_PHOTO_FOREIGN')
    expect(refused.field).toBe('return.photoKeys')
  })

  it('세 장을 붙이면 고른 순서 그대로 남는다', async () => {
    const keys = [3, 1, 2].map((index) => photoKey(buyer.userId, index))
    const { return: detail } = await requestReturn({ photoKeys: keys })

    expect(detail.photoKeys).toEqual(keys)
  })

  /** 거절이 아무것도 남기지 않는다 — 사진을 신청서보다 **먼저** 보는 이유다. */
  it('사진 때문에 거절된 신청은 수량을 잡지 않는다', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    await failure(requestReturn({ returnReason: 'DEFECTIVE', photoKeys: [] }))

    const held = await db.one<{ claimedQuantity: number }>(
      `SELECT "claimedQuantity" FROM "OrderItem" WHERE "id" = $1`,
      [target.id],
    )

    expect(held.claimedQuantity).toBe(0)
  })
})

describe('F3 · F4 · F5 — 수거 → 검수 → 합격 / 불합격', () => {
  it('수거는 회수 운송장을 발급하고 상태를 옮긴다', async () => {
    const { claim } = await requestReturn()

    await approve(claim.id)

    const { claim: moved, return: detail } = await pickUp(claim.id)

    expect(moved.status).toBe('PICKING_UP')
    expect(detail.shipments).toHaveLength(1)
    expect(detail.shipments[0]?.direction).toBe('PICKUP')
    // **번호는 배송과 같은 발급기에서 나온다.** 가상임이 번호에 드러나야 한다는
    // 성질은 물건이 가는 방향과 아무 상관이 없다 (TASK-0061 R1).
    expect(detail.shipments[0]?.trackingNumber).toMatch(/^DEMO-[A-Z]{2}-[0-9]{12}$/u)
    expect(detail.shipments[0]?.carrierName).not.toBe('')
  })

  /**
   * **멱등이다 — 운송장도, 상태도.**
   *
   * 발급과 전이가 한 트랜잭션이므로 두 번째 호출이 볼 것은 「이미 다 된 걸음」이다.
   * 운송장만 세면 「번호는 하나인데 상태는 못 옮긴」 경우를 지나치므로 둘을 함께
   * 잰다.
   */
  it('수거를 두 번 눌러도 운송장은 하나이고 상태도 그대로다', async () => {
    const { claim } = await requestReturn()

    await approve(claim.id)
    await pickUp(claim.id)

    const { claim: again, return: detail } = await pickUp(claim.id)

    expect(detail.shipments).toHaveLength(1)
    expect(again.status).toBe('PICKING_UP')
    expect(await statusOf(claim.id)).toEqual({ status: 'PICKING_UP' })
  })

  /**
   * 거절이 **부수효과를 남기지 않는다.**
   *
   * 운송장이 전이보다 먼저 나므로, 두 쓰기가 한 트랜잭션이 아니면 여기서 「아무
   * 반품에도 속하지 않은 운송장」이 남는다 — 그 행은 아무 오류도 내지 않는다.
   */
  it('승인 전에는 수거할 수 없고, 운송장도 나지 않는다', async () => {
    const { claim } = await requestReturn()
    const refused = await failure(pickUp(claim.id))

    expect(refused.status).toBe(409)
    expect(refused.code).toBe('CLAIM_TRANSITION_UNDEFINED')

    const rows = await db.query(`SELECT 1 FROM "ReturnShipment" WHERE "claimId" = $1`, [claim.id])

    expect(rows).toHaveLength(0)
    expect(await statusOf(claim.id)).toEqual({ status: 'RETURN_REQUESTED' })
  })

  it('합격은 반품완료로 끝나고 검수 기록을 남긴다', async () => {
    const claimId = await upToInspecting()
    const { claim, return: detail } = await inspect(claimId, true)

    expect(claim.status).toBe('RETURN_COMPLETED')
    expect(detail.inspection?.passed).toBe(true)
    expect(detail.inspection?.inspectedAt).toBe(NOW)
    // 합격에는 반송이 없다.
    expect(detail.shipments.map((shipment) => shipment.direction)).toEqual(['PICKUP'])
  })

  it('불합격은 거절로 끝나고 반송 운송장이 난다', async () => {
    const claimId = await upToInspecting()
    const { claim, return: detail } = await inspect(claimId, false)

    expect(claim.status).toBe('RETURN_REJECTED')
    expect(detail.inspection?.passed).toBe(false)
    expect(detail.inspection?.note).toBe('사용감이 뚜렷해요.')
    expect(detail.shipments.map((shipment) => shipment.direction)).toEqual(['PICKUP', 'SEND_BACK'])
  })

  /**
   * 검수 불합격도 **거절**이다. 물건은 판매자에게 있지만 이 신청은 끝났고, 잡고
   * 있던 수량은 돌아와야 한다 — 안 돌아오면 그 항목은 영영 잠긴다.
   */
  it('불합격은 잡고 있던 수량을 돌려준다', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    const claimId = await upToInspecting()

    await inspect(claimId, false)

    const held = await db.one<{ claimedQuantity: number }>(
      `SELECT "claimedQuantity" FROM "OrderItem" WHERE "id" = $1`,
      [target.id],
    )

    expect(held.claimedQuantity).toBe(0)
  })

  it('한 걸음마다 이력이 쌓인다 — 수거도 검수도 상태로 추적된다', async () => {
    const claimId = await upToInspecting()

    await inspect(claimId, true)

    const history = await db.query<{ toStatus: string }>(
      `SELECT "toStatus"::text AS "toStatus" FROM "ClaimStatusHistory"
        WHERE "claimId" = $1 ORDER BY "id"`,
      [claimId],
    )

    expect(history.map((row) => row.toStatus)).toEqual([
      'RETURN_REQUESTED',
      'RETURN_APPROVED',
      'PICKING_UP',
      'INSPECTING',
      'RETURN_COMPLETED',
    ])
  })

  /**
   * **어느 문으로 들어왔든 같은 반품이다** (TASK-0067).
   *
   * 계약이 합쳐지기 전에는 `POST /claims` 가 사유도 사진도 없는 반품을 만들 수
   * 있었고, 그 신청은 며칠 뒤 수거에서 409 로 끝났다 — 신청한 사람이 아무것도
   * 잘못하지 않은 행이었다. 지금은 부속이 신청서의 칸이라 그 상태가 **태어나지
   * 않고**, 그래서 여기서 잴 것은 거절이 아니라 **걸을 수 있다**는 사실이다.
   */
  it('`POST /claims` 로 만든 반품도 수거를 걸을 수 있다', async () => {
    const target = placed.items[0]

    if (target === undefined) throw new Error('항목을 찾지 못했습니다.')

    const { claim } = await client().request({
      path: '/claims',
      method: 'POST',
      body: {
        sellerOrderId: placed.sellerOrderId,
        items: [{ orderItemId: target.id, quantity: 1 }],
        reason: '받아 보니 박음질이 터져 있어요.',
        return: { returnReason: 'DEFECTIVE', photoKeys: [photoKey(buyer.userId, 1)] },
      },
      schema: claimResponseSchema,
    })

    await approve(claim.id)

    const { claim: moved, return: detail } = await pickUp(claim.id)

    expect(moved.status).toBe('PICKING_UP')
    expect(detail.reason).toBe('DEFECTIVE')
    expect(detail.shipments).toHaveLength(1)
  })

  it('입고 전에는 검수할 수 없다', async () => {
    const { claim } = await requestReturn()

    await approve(claim.id)

    const refused = await failure(inspect(claim.id, true))

    expect(refused.status).toBe(409)
    expect(await statusOf(claim.id)).toEqual({ status: 'RETURN_APPROVED' })
  })
})

describe('환불은 합격일 때만 불린다', () => {
  it('합격하면 환불과 재입고가 한 번씩 불린다', async () => {
    const claimId = await upToInspecting()

    await inspect(claimId, true)

    expect(refunded).toHaveLength(1)
    expect(restocked).toHaveLength(1)
    expect(refunded[0]?.claimId).toBe(claimId)
    // 멱등 열쇠가 클레임 id 그 자체다 — 한 반품은 평생 한 번만 완료된다.
    expect(refunded[0]?.idempotencyKey).toBe(claimId)
    // 계산의 입력이 아니라 **계산된 결과**를 싣는다 (하자 = 판매자 부담).
    expect(refunded[0]?.returnShippingDeduction).toBe(0)
    expect(refunded[0]?.lines).toHaveLength(1)
    expect(refunded[0]?.lines[0]?.quantity).toBe(1)
  })

  /** 이 TASK 가 지켜야 할 것 하나. 물건을 안 돌려받았는데 돈이 나가면 안 된다. */
  it('불합격이면 환불도 재입고도 불리지 않는다', async () => {
    const claimId = await upToInspecting()

    await inspect(claimId, false)

    expect(refunded).toHaveLength(0)
    expect(restocked).toHaveLength(0)
  })

  it('단순 변심은 반품비를 뺀 채로 넘어간다', async () => {
    const claimId = await upToInspecting({ returnReason: 'CHANGE_OF_MIND' })

    await inspect(claimId, true)

    const seller = await db.one<{ shippingFee: number }>(
      `SELECT "shippingFee" FROM "Seller" WHERE "id" = $1`,
      [placed.sellerId],
    )

    expect(refunded[0]?.returnShippingDeduction).toBe(seller.shippingFee)
    expect(refunded[0]?.originalShippingRefund).toBe(0)
  })

  /**
   * 검수를 다시 눌러도 **상태는 한 번만 움직이고 시각은 첫 번째 것이 남는다.**
   * 후속은 다시 불리는데, 그것이 「전이는 됐는데 환불을 못 부르고 죽은」 요청을
   * 이어붙이는 유일한 방법이라서다 — 두 번 불려도 안전하도록 멱등 열쇠가 함께 간다.
   */
  it('검수를 두 번 눌러도 기록은 하나이고 열쇠는 같다', async () => {
    const claimId = await upToInspecting()

    await inspect(claimId, true)
    api.clock.set('2026-09-03T01:00:00.000Z')

    const { return: detail } = await inspect(claimId, true)

    expect(detail.inspection?.inspectedAt).toBe(NOW)
    expect(new Set(refunded.map((event) => event.idempotencyKey))).toEqual(new Set([claimId]))
  })
})

describe('A3 · A4 — 남의 반품을 진행시키려는 시도', () => {
  it('다른 가게의 판매자는 수거도 검수도 할 수 없다', async () => {
    const outsider = await storefront([5_000])
    const { claim } = await requestReturn()

    await approve(claim.id)

    expect((await failure(pickUp(claim.id, outsider.seller))).status).toBe(403)
    expect((await failure(inspect(claim.id, true, outsider.seller))).status).toBe(403)
    // 거절이 운송장을 남기지 않는다.
    expect(
      await db.query(`SELECT 1 FROM "ReturnShipment" WHERE "claimId" = $1`, [claim.id]),
    ).toEqual([])
  })

  /**
   * **신청한 사람이 자기 반품을 진행시키지 못한다.** 구매자에게 `claim.handle` 이
   * 없는 것이 첫 번째 방어선이고, 전이표에 `BUYER` 화살표가 없는 것이 두 번째다.
   */
  it('구매자는 자기 반품도 수거·검수할 수 없다', async () => {
    const { claim } = await requestReturn()

    await approve(claim.id)

    expect((await failure(pickUp(claim.id, buyer))).status).toBe(403)
    expect((await failure(inspect(claim.id, true, buyer))).status).toBe(403)
  })

  it('남의 반품은 읽을 수도 없다', async () => {
    const stranger = await createUser(db, {})
    const { claim } = await requestReturn()
    const refused = await failure(
      client({ userId: stranger.id, roles: ['BUYER'] }).request({
        path: `/returns/${claim.id}`,
        method: 'GET',
        schema: returnResponseSchema,
      }),
    )

    expect(refused.status).toBe(403)
  })

  it('토큰 없이 부르면 401 이다', async () => {
    const { claim } = await requestReturn()
    const refused = await failure(
      api.client.request({
        path: `/returns/${claim.id}`,
        method: 'GET',
        schema: returnResponseSchema,
      }),
    )

    expect(refused.status).toBe(401)
  })

  /** 취소 신청에는 반품의 걸음이 없다. 경로는 주문 상태가 정한다. */
  it('취소 신청을 반품으로 진행시킬 수 없다', async () => {
    await db.query(
      `UPDATE "SellerOrder" SET "status" = 'PAID'::"SellerOrderStatus" WHERE "id" = $1`,
      [placed.sellerOrderId],
    )

    const refused = await failure(requestReturn())

    expect(refused.status).toBe(409)
    expect(refused.code).toBe('CLAIM_NOT_CLAIMABLE')
  })
})

describe('S5 — 마지막 방어선은 데이터베이스에 있다', () => {
  it('부담자와 금액이 어긋난 행을 거절한다', async () => {
    const { claim } = await requestReturn({ returnReason: 'CHANGE_OF_MIND' })

    await expect(
      db.query(`UPDATE "ReturnDetail" SET "originalShippingRefund" = 1 WHERE "claimId" = $1`, [
        claim.id,
      ]),
    ).rejects.toThrow(/ReturnDetail_bearer_amount_check/u)
  })

  it('음수 금액을 거절한다', async () => {
    const { claim } = await requestReturn()

    await expect(
      db.query(`UPDATE "ReturnDetail" SET "returnShippingFee" = -1 WHERE "claimId" = $1`, [
        claim.id,
      ]),
    ).rejects.toThrow(/ReturnDetail_amount_check/u)
  })

  it('결과 없는 검수 시각을 거절한다', async () => {
    const { claim } = await requestReturn()

    await expect(
      db.query(`UPDATE "ReturnDetail" SET "inspectedAt" = now() WHERE "claimId" = $1`, [claim.id]),
    ).rejects.toThrow(/ReturnDetail_inspection_check/u)
  })

  it('모양이 아닌 사진 열쇠를 거절한다', async () => {
    const { claim } = await requestReturn()

    await expect(
      db.query(`UPDATE "ReturnPhoto" SET "key" = 'returns/nope.jpg' WHERE "claimId" = $1`, [
        claim.id,
      ]),
    ).rejects.toThrow(/ReturnPhoto_key_format_check/u)
  })

  it('가상임이 드러나지 않는 회수 운송장 번호를 거절한다', async () => {
    const { claim } = await requestReturn()

    await approve(claim.id)
    await pickUp(claim.id)

    await expect(
      db.query(
        `UPDATE "ReturnShipment" SET "trackingNumber" = '123456789012' WHERE "claimId" = $1`,
        [claim.id],
      ),
    ).rejects.toThrow(/ReturnShipment_trackingNumber_format_check/u)
  })

  it('한 반품에 같은 방향의 운송장을 두 번 넣을 수 없다', async () => {
    const { claim } = await requestReturn()

    await approve(claim.id)
    await pickUp(claim.id)

    await expect(
      db.query(
        `INSERT INTO "ReturnShipment"
           ("id", "claimId", "direction", "carrierCode", "carrierName", "trackingNumber", "issuedAt")
         VALUES (gen_random_uuid(), $1, 'PICKUP', 'GA', '가온물류', 'DEMO-GA-000000000001', now())`,
        [claim.id],
      ),
    ).rejects.toThrow(/ReturnShipment_claimId_direction_key/u)
  })
})

describe('settled cancellations leave only the remaining items to return', () => {
  it.each(['CANCEL_APPROVED', 'REFUNDED'] as const)(
    'closes the order after returning the remainder of a %s cancellation',
    async (status) => {
      const prisma = api.resolve<PrismaService>(PrismaService)
      const canceled = placed.items[1]!
      await prisma.claimRequest.create({
        data: {
          sellerOrderId: placed.sellerOrderId,
          requestedById: buyer.userId,
          type: 'CANCEL',
          status,
          fault: 'CUSTOMER',
          reason: '발송 전 확정된 취소',
          items: { create: { orderItemId: canceled.id, quantity: canceled.quantity } },
        },
      })
      await prisma.orderItem.update({
        where: { id: canceled.id },
        data: { claimedQuantity: canceled.quantity },
      })
      const claimId = await upToInspecting({ returnReason: 'CHANGE_OF_MIND' })
      await inspect(claimId, true)
      expect(
        (await prisma.sellerOrder.findUniqueOrThrow({ where: { id: placed.sellerOrderId } }))
          .status,
      ).toBe('RETURNED')
      expect(
        await prisma.orderStatusHistory.count({
          where: { sellerOrderId: placed.sellerOrderId, toStatus: 'RETURNED' },
        }),
      ).toBe(1)
    },
  )
})
