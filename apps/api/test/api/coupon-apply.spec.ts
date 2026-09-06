import type { ApiClient, CheckoutCouponsResponse, OrderResponse } from '@shopping/shared'
import {
  ApiClientError,
  isApiFieldError,
  cartResponseSchema,
  checkoutCouponsResponseSchema,
  checkoutResponseSchema,
  orderResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { useApiApp } from '../support/api-app.js'
import { barrier, concurrently, fulfilled, rejected } from '../support/concurrently.js'
import { useDatabase } from '../support/database.js'
import {
  createAddress,
  createCategory,
  createCoupon,
  createProduct,
  createProductVariant,
  createSeller,
  createUser,
  createUserCoupon,
} from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'

/**
 * 쿠폰 적용 (TASK-0075), 실제 HTTP 로 실제 데이터베이스에 대고.
 *
 * 판단이 옳은지는 `coupon-apply.spec.ts` 가 순수 함수로 잰다. **여기서 재는 것은 그
 * 판단이 실제 주문서와 주문에 닿는가**이고, 값의 대부분이 셋에 몰려 있다.
 *
 * - **계산기를 고치지 않고 연결된다** (F1). 안분된 금액이 항목까지 저장되는지를
 *   보는 것이 그 증거다 — 계산기가 그대로라면 그 숫자는 M07 의 규칙 그대로다.
 * - **판매자 쿠폰이 남의 가게를 깎지 않는다** (F3). 한 칸 넓으면 사는 사람의
 *   화면에는 아무 이상이 없고, 그 부담은 정산일에 남의 정산액에서 발견된다.
 * - **한 장이 두 주문에 쓰이지 않는다** (F5). 동시에 쏘는 것만으로는 겹침이
 *   우연이므로, 아래는 잠금으로 **겹침을 배열한다.**
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/** 동시 주문 두 건. 한 장을 놓고 다투는 최소 인원이다. */
const RACE_PARTIES = 2

const BLOCKED_ATTEMPTS = 200

let buyer: TestCaller
let addressId: string
let categoryId: number

interface Store {
  readonly sellerId: string
  readonly productId: string
  readonly variantId: string
}

async function store(
  options: {
    readonly price?: number
    readonly shippingFee?: number
    readonly freeShippingThreshold?: number | null
    readonly categoryId?: number
  } = {},
): Promise<Store> {
  const owner = await createUser(db)
  const seller = await createSeller(db, { userId: owner.id })

  if (options.shippingFee !== undefined) {
    await db.query(
      `UPDATE "Seller" SET "shippingFee" = $2, "freeShippingThreshold" = $3 WHERE "id" = $1`,
      [seller.id, options.shippingFee, options.freeShippingThreshold ?? null],
    )
  }

  const product = await createProduct(db, {
    sellerId: seller.id,
    categoryId: options.categoryId ?? categoryId,
    status: 'ACTIVE',
    minPrice: options.price ?? 10_000,
  })
  const variant = await createProductVariant(db, {
    productId: product.id,
    sellerId: seller.id,
    price: options.price ?? 10_000,
    stock: 10,
    isActive: true,
  })

  return { sellerId: seller.id, productId: product.id, variantId: variant.id }
}

function client(caller: TestCaller = buyer): ApiClient {
  return api.clientAs(caller)
}

async function add(variantId: string, caller: TestCaller = buyer): Promise<string> {
  const cart = await client(caller).request({
    path: '/cart/items',
    method: 'POST',
    body: { variantId, quantity: 1 },
    schema: cartResponseSchema,
  })
  const line = cart.groups
    .flatMap((group) => group.items)
    .find((item) => item.variantId === variantId)

  if (line === undefined) throw new Error('담긴 줄을 찾지 못했습니다.')

  return line.id
}

async function openCheckout(itemIds: readonly string[]): Promise<string> {
  const { checkout } = await client().request({
    path: '/checkouts',
    method: 'POST',
    body: { itemIds },
    schema: checkoutResponseSchema,
  })

  return checkout.id
}

function readCheckout(id: string, userCouponIds: readonly string[] = []) {
  const query = userCouponIds.length === 0 ? '' : `?userCouponIds=${userCouponIds.join(',')}`

  return client().request({ path: `/checkouts/${id}${query}`, schema: checkoutResponseSchema })
}

function couponsOf(checkoutId: string): Promise<CheckoutCouponsResponse> {
  return client().request({
    path: `/checkouts/${checkoutId}/coupons`,
    schema: checkoutCouponsResponseSchema,
  })
}

function place(
  itemIds: readonly string[],
  userCouponIds: readonly string[] = [],
  caller: TestCaller = buyer,
): Promise<OrderResponse> {
  return client(caller).request({
    path: '/orders',
    method: 'POST',
    body: { itemIds, addressId, userCouponIds },
    schema: orderResponseSchema,
  })
}

interface HttpFailure {
  readonly status: number
  readonly code: string
  readonly reason: string | number | undefined
}

async function failure(work: Promise<unknown>): Promise<HttpFailure> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  // 사유는 `details[0].params.reason` 에 있다 — 코드를 사유마다 나누지 않은 것이
  // 계약의 판단이고(`error-codes.ts`), 화면도 여기를 읽는다.
  const detail = error.body?.error.details?.[0]

  return {
    status: error.status ?? 0,
    code: error.body?.error.code ?? '',
    reason: isApiFieldError(detail) ? detail.params?.reason : undefined,
  }
}

/** 한 장을 이 구매자에게 발급한다. */
async function issue(
  options: Parameters<typeof createCoupon>[1] & { readonly expiresAt?: string } = {},
): Promise<string> {
  const coupon = await createCoupon(db, options)
  const issued = await createUserCoupon(db, {
    couponId: coupon.id,
    userId: buyer.userId,
    expiresAt: options.expiresAt,
  })

  return issued.id
}

beforeEach(async () => {
  const account = await createUser(db)

  buyer = { userId: account.id, roles: ['BUYER'] }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  categoryId = (await createCategory(db)).id
})

describe('적용 가능 쿠폰 조회 (F2)', () => {
  it('answers with every issued coupon and why each one cannot be used', async () => {
    const shop = await store({ price: 10_000 })
    const usable = await issue({ discountValue: 3_000 })
    const tooExpensive = await issue({ discountValue: 3_000, minOrderAmount: 50_000 })
    const elsewhere = await issue({
      scopeType: 'SELLER',
      scopeIds: ['00000000-0000-4000-8000-000000000001'],
    })
    const checkoutId = await openCheckout([await add(shop.variantId)])

    const { coupons } = await couponsOf(checkoutId)
    const byId = new Map(coupons.map((entry) => [entry.userCoupon.id, entry]))

    expect(byId.get(usable)?.fault).toBeNull()
    expect(byId.get(usable)?.discountAmount).toBe(3_000)
    // **사유가 다르다.** 하나는 더 담으면 되고 하나는 무엇을 해도 안 된다 — 한
    // 문장으로 답하는 화면은 둘 중 하나에게 반드시 틀린 말을 한다.
    expect(byId.get(tooExpensive)?.fault).toBe('below_minimum')
    expect(byId.get(elsewhere)?.fault).toBe('out_of_scope')
    expect(byId.get(tooExpensive)?.discountAmount).toBe(0)
  })

  /** 남의 쿠폰함은 보이지 않는다. 목록은 부르는 사람의 것으로만 만들어진다. */
  it('never shows someone else’s coupons', async () => {
    const shop = await store()
    const stranger = await createUser(db)
    const coupon = await createCoupon(db, {})

    await createUserCoupon(db, { couponId: coupon.id, userId: stranger.id })

    const checkoutId = await openCheckout([await add(shop.variantId)])

    expect((await couponsOf(checkoutId)).coupons).toEqual([])
  })
})

describe('안분 (F1 · F3 · F8)', () => {
  /**
   * **판매자 쿠폰은 그 가게의 항목에만 닿는다.** 한 칸 넓으면 판매자가 낸 쿠폰이
   * 남의 매출을 깎고, 그 부담은 정산일까지 아무 데도 나타나지 않는다.
   */
  it('keeps a seller coupon inside that seller’s share', async () => {
    const mine = await store({ price: 10_000 })
    const theirs = await store({ price: 10_000 })
    const userCouponId = await issue({
      sellerId: mine.sellerId,
      scopeType: 'SELLER',
      scopeIds: [mine.sellerId],
      discountValue: 4_000,
    })
    const itemIds = [await add(mine.variantId), await add(theirs.variantId)]
    const checkoutId = await openCheckout(itemIds)

    const { checkout } = await readCheckout(checkoutId, [userCouponId])
    const mineShare = checkout.sellerOrders.find((entry) => entry.sellerId === mine.sellerId)
    const theirShare = checkout.sellerOrders.find((entry) => entry.sellerId === theirs.sellerId)

    expect(mineShare?.couponDiscountAmount).toBe(4_000)
    expect(theirShare?.couponDiscountAmount).toBe(0)
    expect(checkout.totalCouponDiscountAmount).toBe(4_000)
  })

  /** 플랫폼 쿠폰은 주문 전체에 안분된다 — 합계는 언제나 쿠폰 할인액이다. */
  it('spreads a platform coupon across every seller', async () => {
    const first = await store({ price: 10_000 })
    const second = await store({ price: 30_000 })
    const userCouponId = await issue({ discountValue: 4_000 })
    const checkoutId = await openCheckout([await add(first.variantId), await add(second.variantId)])

    const { checkout } = await readCheckout(checkoutId, [userCouponId])
    const shares = checkout.sellerOrders.map((entry) => entry.couponDiscountAmount)

    expect([...shares].sort((left, right) => left - right)).toEqual([1_000, 3_000])
    // 장별 금액은 **합계가 감추는 사실**이다. 두 장이 겹쳐 덮이면 뒤엣것이 잘리고,
    // 그때 합계만 보면 「두 장을 썼는데 한 장 값만 빠졌다」로 보인다.
    const applied = checkout.appliedCoupons[0]

    expect(checkout.appliedCoupons).toHaveLength(1)
    expect(applied?.userCouponId).toBe(userCouponId)
    expect(applied?.issuerType).toBe('PLATFORM')
    expect(applied?.discountAmount).toBe(4_000)
  })

  /**
   * 상품 범위 쿠폰은 계산기의 어느 범위에도 맞지 않아 **우리가 안분해 넘긴다.**
   * 그래도 항목에 실제로 붙는 금액은 계산기가 낸 값이라는 것을 여기서 잰다.
   */
  it('applies a product-scoped coupon only to that product', async () => {
    const shop = await store({ price: 10_000 })
    const other = await createProductVariant(db, {
      productId: shop.productId,
      sellerId: shop.sellerId,
      price: 10_000,
      stock: 10,
      optionSignature: 'second',
    })
    const alone = await store({ price: 10_000 })
    const userCouponId = await issue({ scopeType: 'PRODUCT', scopeIds: [shop.productId] })
    const checkoutId = await openCheckout([
      await add(shop.variantId),
      await add(other.id),
      await add(alone.variantId),
    ])

    const { checkout } = await readCheckout(checkoutId, [userCouponId])
    const mine = checkout.sellerOrders.find((entry) => entry.sellerId === shop.sellerId)

    expect(mine?.couponDiscountAmount).toBe(3_000)
    expect(checkout.totalCouponDiscountAmount).toBe(3_000)
  })
})

describe('거절 (F2 · F4)', () => {
  it('refuses a coupon that cannot be used here, naming the reason', async () => {
    const shop = await store({ price: 10_000 })
    const userCouponId = await issue({ minOrderAmount: 50_000 })
    const checkoutId = await openCheckout([await add(shop.variantId)])

    expect(await failure(readCheckout(checkoutId, [userCouponId]))).toEqual({
      status: 400,
      code: 'COUPON_NOT_APPLICABLE',
      reason: 'below_minimum',
    })
  })

  it('refuses two platform coupons at once', async () => {
    const shop = await store({ price: 10_000 })
    const first = await issue({ discountValue: 1_000 })
    const second = await issue({ discountValue: 2_000 })
    const checkoutId = await openCheckout([await add(shop.variantId)])

    expect(await failure(readCheckout(checkoutId, [first, second]))).toEqual({
      status: 400,
      code: 'COUPON_NOT_APPLICABLE',
      reason: 'duplicate_platform',
    })
  })

  it('refuses two coupons of the same seller', async () => {
    const shop = await store({ price: 10_000 })
    const scope = {
      sellerId: shop.sellerId,
      scopeType: 'SELLER' as const,
      scopeIds: [shop.sellerId],
    }
    const first = await issue({ ...scope, discountValue: 1_000 })
    const second = await issue({ ...scope, discountValue: 2_000 })
    const checkoutId = await openCheckout([await add(shop.variantId)])

    expect((await failure(readCheckout(checkoutId, [first, second]))).reason).toBe(
      'duplicate_seller',
    )
  })

  /** 남의 쿠폰과 없는 쿠폰이 같은 답을 받는다 — 갈라 답하면 존재를 알려 주게 된다. */
  it('answers the same for a stranger’s coupon as for one that does not exist', async () => {
    const shop = await store()
    const stranger = await createUser(db)
    const coupon = await createCoupon(db, {})
    const theirs = await createUserCoupon(db, { couponId: coupon.id, userId: stranger.id })
    const checkoutId = await openCheckout([await add(shop.variantId)])
    const missing = await failure(
      readCheckout(checkoutId, ['00000000-0000-4000-8000-000000000009']),
    )

    expect(await failure(readCheckout(checkoutId, [theirs.id]))).toEqual(missing)
    expect(missing.reason).toBe('unknown')
  })
})

describe('빈 선택', () => {
  /**
   * `?userCouponIds=` 하나로 오는 요청은 **아무것도 고르지 않은 것**이다. 빈 배열을
   * 쿼리로 잇다 보면 흔히 나오는 모양이고, 그 뜻은 명백하다 — 400 으로 답하면
   * 주문서가 통째로 안 열린다.
   */
  it('reads a checkout with an empty selection', async () => {
    const shop = await store({ price: 10_000 })
    const checkoutId = await openCheckout([await add(shop.variantId)])
    const { checkout } = await client().request({
      path: `/checkouts/${checkoutId}?userCouponIds=`,
      schema: checkoutResponseSchema,
    })

    expect(checkout.appliedCoupons).toEqual([])
    expect(checkout.totalCouponDiscountAmount).toBe(0)
  })
})

describe('최대 할인 조합 (F7)', () => {
  it('recommends the combination that pays least', async () => {
    const shop = await store({ price: 20_000 })
    const small = await issue({ discountValue: 1_000 })
    const big = await issue({ discountValue: 5_000 })
    const sellers = await issue({
      sellerId: shop.sellerId,
      scopeType: 'SELLER',
      scopeIds: [shop.sellerId],
      discountValue: 2_000,
    })
    const checkoutId = await openCheckout([await add(shop.variantId)])

    const { recommendation } = await couponsOf(checkoutId)

    expect([...recommendation.userCouponIds].sort()).toEqual([big, sellers].sort())
    expect(recommendation.discountAmount).toBe(7_000)
    expect(recommendation.exhaustive).toBe(true)

    // 그리고 그 추천을 그대로 적용하면 그 금액이 나온다 — 추천과 적용이 같은
    // 계산기를 지난다는 뜻이고, 갈리면 「추천대로 골랐는데 금액이 다르다」가 된다.
    const { checkout } = await readCheckout(checkoutId, recommendation.userCouponIds)

    expect(checkout.totalCouponDiscountAmount).toBe(7_000)
    expect(small).not.toBe('')
  })

  /**
   * **할인액이 아니라 낼 돈으로 고른다.** 무료배송 판정이 쿠폰까지 반영한 상품금액
   * 기준이라(`pricing.md` 1장), 큰 쿠폰이 문턱 아래로 끌어내리면 배송비가 되살아난다.
   */
  it('refuses a bigger coupon that would cost the free shipping', async () => {
    const shop = await store({ price: 10_000, shippingFee: 3_000, freeShippingThreshold: 9_000 })
    const small = await issue({ discountValue: 1_000 })

    await issue({ discountValue: 2_000 })

    const checkoutId = await openCheckout([await add(shop.variantId)])
    const { recommendation } = await couponsOf(checkoutId)

    expect(recommendation.userCouponIds).toEqual([small])

    const { checkout } = await readCheckout(checkoutId, recommendation.userCouponIds)

    expect(checkout.totalShippingFee).toBe(0)
    expect(checkout.paidAmount).toBe(9_000)
  })
})

describe('사용 처리 (F5 · F6)', () => {
  it('marks the coupon used and records what it took off', async () => {
    const shop = await store({ price: 10_000 })
    const userCouponId = await issue({ discountValue: 3_000 })
    const { order } = await place([await add(shop.variantId)], [userCouponId])
    const row = await db.one<{
      status: string
      orderId: string
      usedAt: Date
      discountAmount: number
    }>(
      `SELECT "status"::text AS "status", "orderId", "usedAt", "discountAmount"
         FROM "UserCoupon" WHERE "id" = $1`,
      [userCouponId],
    )

    expect(row.status).toBe('USED')
    expect(row.orderId).toBe(order.id)
    expect(row.discountAmount).toBe(3_000)
    expect(order.totalCouponDiscountAmount).toBe(3_000)
  })

  /**
   * **주문 항목에 「판매자가 부담한 몫」이 따로 적힌다** (TASK-0080 F3 · F4).
   *
   * 사는 사람이 내는 돈은 누가 부담하든 같아서, 이 값이 틀려도 결제 화면은 아무 말도
   * 하지 않는다. 틀어진 금액은 몇 주 뒤 정산서 한 줄로만 나타난다 — 판매자가 부담한
   * 적 없는 할인이 그의 정산액에서 빠지면 그것은 **남의 돈으로 한 할인의 청구서를
   * 그에게 보내는** 일이다.
   *
   * 부담 주체별 안분의 산술은 `packages/shared/test/pricing.spec.ts` 가 잰다. 여기서
   * 재는 것은 **그 값이 실제로 주문 항목까지 도착하는가**다.
   */
  it('splits the borne share onto the order item (TASK-0080)', async () => {
    const shop = await store({ price: 10_000 })
    const platform = await issue({ discountValue: 3_000 })
    const seller = await issue({
      sellerId: shop.sellerId,
      scopeType: 'SELLER',
      scopeIds: [shop.sellerId],
      discountValue: 1_000,
    })
    const { order } = await place([await add(shop.variantId)], [platform, seller])
    const row = await db.one<{ couponDiscountAmount: number; sellerCouponDiscountAmount: number }>(
      `SELECT oi."couponDiscountAmount", oi."sellerCouponDiscountAmount"
         FROM "OrderItem" oi
         JOIN "SellerOrder" so ON so."id" = oi."sellerOrderId"
        WHERE so."orderId" = $1`,
      [order.id],
    )

    expect(row.couponDiscountAmount).toBe(4_000)
    expect(row.sellerCouponDiscountAmount).toBe(1_000)
  })

  it('refuses a second order with the same coupon', async () => {
    const shop = await store({ price: 10_000 })
    const userCouponId = await issue({ discountValue: 3_000 })

    await place([await add(shop.variantId)], [userCouponId])

    const second = await store({ price: 10_000 })

    expect((await failure(place([await add(second.variantId)], [userCouponId]))).reason).toBe(
      'already_used',
    )
  })

  /**
   * **한 장이 두 주문에 쓰이지 않는다** (F5).
   *
   * 동시에 쏘는 것만으로는 겹침이 우연이고, 겹치지 않은 실행에서도 단언은 초록이다.
   * 그래서 바깥에서 그 행을 잠가 두고 두 주문이 **둘 다 그 잠금을 기다리는 것**을
   * 확인한 뒤에 푼다 — 그때 비로소 「둘 다 `ISSUED` 를 읽었다」가 배열된다.
   *
   * 두 주문이 서로 다른 가게의 서로 다른 상품을 사는 것도 그래서다. 같은 조합이면
   * 재고 예약에서 먼저 줄을 서게 되어 쿠폰 앞에서 겹치지 않는다.
   */
  it('lets exactly one of two concurrent orders spend the coupon', async () => {
    const first = await store({ price: 10_000 })
    const second = await store({ price: 10_000 })
    const userCouponId = await issue({ discountValue: 3_000 })
    const itemIds = [await add(first.variantId), await add(second.variantId)]
    const gate = barrier(RACE_PARTIES)
    const results = await db.withConnection(async (blocker) => {
      await blocker.query('BEGIN')
      await blocker.query('SELECT "id" FROM "UserCoupon" WHERE "id" = $1 FOR UPDATE', [
        userCouponId,
      ])

      const pending = concurrently(RACE_PARTIES, async (index) => {
        await gate.arrive()

        return place([itemIds[index] ?? ''], [userCouponId])
      })

      try {
        await awaitBothBlocked()
      } finally {
        await blocker.query('COMMIT')
      }

      return pending
    })

    expect(fulfilled(results)).toHaveLength(1)
    expect(rejected(results)).toHaveLength(1)

    const spent = await db.one<{ used: number }>(
      `SELECT count(*)::int AS "used" FROM "UserCoupon"
        WHERE "id" = $1 AND "status" = 'USED'`,
      [userCouponId],
    )

    expect(spent.used).toBe(1)

    // 진 쪽은 주문도 남기지 않는다. 쿠폰 없이 만들어 주면 사는 사람이 동의한 적
    // 없는 금액이 결제된다.
    const orders = await db.one<{ count: number }>(
      `SELECT count(*)::int AS "count" FROM "Order" WHERE "userId" = $1`,
      [buyer.userId],
    )

    expect(orders.count).toBe(1)
  })
})

/** 두 주문이 모두 쿠폰 행의 잠금을 기다릴 때까지. */
async function awaitBothBlocked(): Promise<void> {
  for (let attempt = 0; attempt < BLOCKED_ATTEMPTS; attempt += 1) {
    const row = await db.one<{ waiting: number }>(
      `SELECT count(*)::int AS waiting
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND query LIKE '%UPDATE "UserCoupon"%'`,
    )

    if (row.waiting >= RACE_PARTIES) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  throw new Error('두 주문이 잠금 대기 상태가 되지 않았습니다 — 겹침이 배열되지 않았습니다.')
}
