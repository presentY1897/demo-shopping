import type { ApiClient } from '@shopping/shared'
import {
  cartResponseSchema,
  orderResponseSchema,
  settlementDetailResponseSchema,
  settlementOutlookResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { SettlementBatchService } from '../../src/settlement/settlement-batch.service.js'
import { useApiApp } from '../support/api-app.js'
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
 * 장바구니에서 정산까지 **한 번에 걸어 본다** (M12).
 *
 * 조각마다의 검사는 따로 있다 — 안분은 `pricing.spec.ts`, 요율은
 * `commission-rate.spec.ts`, 배치는 `settlement-batch.spec.ts`. **여기서 재는 것은 그
 * 조각들이 이어졌을 때도 같은 답을 내는가**이고, 그것이 D-032 의 「앞서 정한 것들이
 * 전부 정산 한 줄로 만난다」가 참인지를 확인하는 유일한 자리다.
 *
 * 특히 **부담 주체**가 그렇다. 계산기는 부담 주체를 나눠 세고, 주문은 그것을 항목에
 * 적고, 배치는 그중 판매자 몫만 뺀다 — 세 곳이 각자 맞아도 이어지는 지점에서 값이
 * 새면 판매자는 남의 돈으로 한 할인의 청구서를 받는다. 그 새는 지점은 조각 검사가
 * 절대 밟지 않는다.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

const NOW = '2026-09-09T05:00:00.000Z'
/** 배치가 「지난주」로 집는 주 안의 한 시점. */
const CONFIRMED_AT = '2026-09-02T05:00:00.000Z'

const PRICE = 10_000
const PLATFORM_COUPON = 3_000
const SELLER_COUPON = 1_000

let buyer: TestCaller
let superAdmin: TestCaller
let seller: TestCaller
let addressId: string
let sellerId: string
let variantId: string

beforeEach(async () => {
  api.clock.set(NOW)

  const account = await createUser(db)

  buyer = { userId: account.id, roles: ['BUYER'] }
  addressId = (await createAddress(db, { userId: account.id, isDefault: true })).id
  superAdmin = { userId: (await createUser(db)).id, roles: ['ADMIN_SUPER'] }

  const owner = await createUser(db)
  const store = await createSeller(db, { userId: owner.id })

  sellerId = store.id
  seller = { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: store.id }

  const categoryId = (await createCategory(db)).id
  const product = await createProduct(db, {
    sellerId,
    categoryId,
    status: 'ACTIVE',
    minPrice: PRICE,
  })
  const variant = await createProductVariant(db, {
    productId: product.id,
    sellerId,
    price: PRICE,
    stock: 10,
    isActive: true,
  })

  variantId = variant.id
})

function client(caller: TestCaller): ApiClient {
  return api.clientAs(caller)
}

/** 이 사람에게 쿠폰 한 장을 발급한다. */
async function issue(options: Parameters<typeof createCoupon>[1]): Promise<string> {
  const coupon = await createCoupon(db, options)
  const issued = await createUserCoupon(db, { couponId: coupon.id, userId: buyer.userId })

  return issued.id
}

describe('장바구니 → 주문 → 구매확정 → 정산', () => {
  /**
   * **플랫폼 쿠폰은 판매자의 정산을 깎지 않는다** (D-029).
   *
   * 손님은 10,000원짜리를 6,000원에 샀지만(플랫폼 3,000 + 판매자 1,000), 판매자는
   * **정가 10,000원 기준으로** 정산받는다. 빠지는 것은 수수료 1,000원과 자기가
   * 부담한 쿠폰 1,000원뿐이다.
   */
  it('플랫폼 부담은 판매자의 지급액을 깎지 않는다', async () => {
    const platform = await issue({ discountValue: PLATFORM_COUPON })
    const own = await issue({
      sellerId,
      scopeType: 'SELLER',
      scopeIds: [sellerId],
      discountValue: SELLER_COUPON,
    })
    const cart = await client(buyer).request({
      path: '/cart/items',
      method: 'POST',
      body: { variantId, quantity: 1 },
      schema: cartResponseSchema,
    })
    const itemId = cart.groups.flatMap((group) => group.items)[0]?.id

    const { order } = await client(buyer).request({
      path: '/orders',
      method: 'POST',
      body: { itemIds: [itemId], addressId, userCouponIds: [platform, own] },
      schema: orderResponseSchema,
    })

    // 손님이 낸 돈에는 두 쿠폰이 모두 반영돼 있다.
    expect(order.totalCouponDiscountAmount).toBe(PLATFORM_COUPON + SELLER_COUPON)

    // 구매확정. 상태 머신을 지나지 않는 이유는 여기서 재는 것이 전이가 아니어서다.
    await db.execute(
      `UPDATE "SellerOrder" SET "status" = 'CONFIRMED'::"SellerOrderStatus" WHERE "orderId" = $1`,
      [order.id],
    )
    await db.execute(
      `INSERT INTO "OrderStatusHistory"
         ("id", "sellerOrderId", "fromStatus", "toStatus", "actor", "createdAt")
       SELECT gen_random_uuid(), so."id", 'DELIVERED'::"SellerOrderStatus",
              'CONFIRMED'::"SellerOrderStatus", 'SYSTEM'::"OrderActor", $2::timestamptz
         FROM "SellerOrder" so WHERE so."orderId" = $1`,
      [order.id, CONFIRMED_AT],
    )

    // 정산 예정 금액은 정산서가 나오기 **전에** 같은 답을 이미 알고 있다.
    const outlook = await client(seller).request({
      path: '/seller-settlement-outlook',
      schema: settlementOutlookResponseSchema,
    })

    expect(outlook.awaitingSettlement).toEqual({ sellerOrderCount: 1, payoutAmount: 8_000 })

    await api.resolve<SettlementBatchService>(SettlementBatchService).run()

    const [row] = await db.query<{ id: string }>(`SELECT "id" FROM "Settlement"`)
    const detail = await client(superAdmin).request({
      path: `/settlements/${row?.id ?? ''}`,
      schema: settlementDetailResponseSchema,
    })

    expect(detail.settlement).toMatchObject({
      // 판매액은 **정가**다 — 플랫폼 쿠폰이 깎지 않는다.
      salesAmount: PRICE,
      commissionAmount: 1_000,
      // 판매자가 부담한 몫만 빠진다.
      sellerCouponAmount: SELLER_COUPON,
      returnAdjustmentAmount: 0,
      payoutAmount: 8_000,
    })
    expect(detail.items).toHaveLength(1)
  })

  /**
   * **판매자와 관리자가 같은 숫자를 본다** (TASK-0082 F3).
   *
   * 검사로 지키는 것이 아니라 **구조로** 지킨다 — 라우트가 하나뿐이면 갈라질 자리가
   * 없다. 이 검사가 지키는 것은 그 하나가 판매자에게도 열려 있는가다.
   */
  it('판매자와 관리자가 같은 정산서를 같은 금액으로 읽는다', async () => {
    const cart = await client(buyer).request({
      path: '/cart/items',
      method: 'POST',
      body: { variantId, quantity: 1 },
      schema: cartResponseSchema,
    })
    const itemId = cart.groups.flatMap((group) => group.items)[0]?.id
    const { order } = await client(buyer).request({
      path: '/orders',
      method: 'POST',
      body: { itemIds: [itemId], addressId },
      schema: orderResponseSchema,
    })

    await db.execute(
      `INSERT INTO "OrderStatusHistory"
         ("id", "sellerOrderId", "fromStatus", "toStatus", "actor", "createdAt")
       SELECT gen_random_uuid(), so."id", 'DELIVERED'::"SellerOrderStatus",
              'CONFIRMED'::"SellerOrderStatus", 'SYSTEM'::"OrderActor", $2::timestamptz
         FROM "SellerOrder" so WHERE so."orderId" = $1`,
      [order.id, CONFIRMED_AT],
    )
    await api.resolve<SettlementBatchService>(SettlementBatchService).run()

    const [row] = await db.query<{ id: string }>(`SELECT "id" FROM "Settlement"`)
    const path = `/settlements/${row?.id ?? ''}`
    const [byAdmin, bySeller] = await Promise.all([
      client(superAdmin).request({ path, schema: settlementDetailResponseSchema }),
      client(seller).request({ path, schema: settlementDetailResponseSchema }),
    ])

    expect(bySeller).toEqual(byAdmin)
  })
})
