import { randomUUID } from 'node:crypto'

import { DatabaseError } from 'pg'
import { describe, expect, it } from 'vitest'

import { useDatabase } from '../support/database.js'
import {
  createAddress,
  createCategory,
  createCommissionRate,
  createSellableVariant,
  createSeller,
  createUser,
} from '../support/factories.js'

/**
 * Gate S5, promoted from reading files to asking the database (TASK-0106 4.8).
 *
 * Five rules cannot be written in PSL and live as hand written SQL at the bottom
 * of a migration. Until now `src/prisma/schema-guards.spec.ts` checked that the
 * SQL *string* was still in the file, which catches a deletion and nothing else:
 * changing `WHERE "isDefault"` to `WHERE NOT "isDefault"` would keep the string
 * check green while a user could no longer keep more than one address.
 *
 * So each rule is tried twice.
 *
 * - **A violation is rejected**, with the SQLSTATE and the constraint name
 *   asserted. `23505` is a unique violation, `23514` a CHECK violation.
 * - **What must be allowed is allowed.** This is the half a string check can
 *   never do, and the half that catches a predicate written backwards.
 *
 * Every attempt is raw SQL. Going through Prisma would let application level
 * validation answer first, and the entire question here is whether *the
 * database* refuses.
 */

const db = useDatabase()

/** Runs `work`, asserting it was the database that refused, and how. */
async function refusal(work: Promise<unknown>): Promise<DatabaseError> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof DatabaseError)) {
    throw new Error(
      `DB 가 거부할 것으로 기대했지만 성공했거나 다른 오류가 났습니다: ${String(error)}`,
    )
  }
  return error
}

describe('Address_userId_default_key — one default address per user', () => {
  it('refuses a second default address for the same user', async () => {
    const user = await createUser(db)

    await createAddress(db, { userId: user.id, isDefault: true })

    const error = await refusal(createAddress(db, { userId: user.id, isDefault: true }))

    expect(error.code).toBe('23505')
    expect(error.constraint).toBe('Address_userId_default_key')
  })

  it('allows any number of non-default addresses for one user', async () => {
    const user = await createUser(db)

    await createAddress(db, { userId: user.id, isDefault: false })
    await createAddress(db, { userId: user.id, isDefault: false })
    await createAddress(db, { userId: user.id, isDefault: true })

    const { count } = await db.one<{ count: string }>(
      `SELECT count(*)::text AS count FROM "Address" WHERE "userId" = $1`,
      [user.id],
    )

    expect(count).toBe('3')
  })

  it('allows two different users to each have a default', async () => {
    const [one, two] = [await createUser(db), await createUser(db)]

    await createAddress(db, { userId: one.id, isDefault: true })
    await createAddress(db, { userId: two.id, isDefault: true })

    const { count } = await db.one<{ count: string }>(
      `SELECT count(*)::text AS count FROM "Address" WHERE "isDefault"`,
    )

    expect(count).toBe('2')
  })
})

describe('User_googleSub_active_key — one live account per Google identity', () => {
  it('refuses a second live account with the same Google subject', async () => {
    await createUser(db, { googleSub: 'google-subject-1' })

    const error = await refusal(createUser(db, { googleSub: 'google-subject-1' }))

    expect(error.code).toBe('23505')
    expect(error.constraint).toBe('User_googleSub_active_key')
  })

  it('lets a withdrawn account sign up again with the same identity', async () => {
    await createUser(db, {
      googleSub: 'google-subject-2',
      deletedAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    const reborn = await createUser(db, { googleSub: 'google-subject-2' })

    expect(reborn.deletedAt).toBeNull()
  })

  it('lets any number of demo accounts exist without a Google identity', async () => {
    await createUser(db, { isDemo: true })
    await createUser(db, { isDemo: true })

    const { count } = await db.one<{ count: string }>(
      `SELECT count(*)::text AS count FROM "User" WHERE "googleSub" IS NULL`,
    )

    expect(count).toBe('2')
  })
})

describe('User_demo_expiry_check — demo flag and expiry agree', () => {
  it('refuses a demo account without an expiry', async () => {
    const error = await refusal(createUser(db, { isDemo: true, demoExpiresAt: null }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('User_demo_expiry_check')
  })

  it('refuses a real account that carries an expiry', async () => {
    const error = await refusal(
      createUser(db, { isDemo: false, demoExpiresAt: new Date('2026-09-04T00:00:00.000Z') }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('User_demo_expiry_check')
  })

  it('allows a demo account with an expiry and a real account without one', async () => {
    const demo = await createUser(db, { isDemo: true })
    const real = await createUser(db, { isDemo: false })

    expect(demo.demoExpiresAt).not.toBeNull()
    expect(real.demoExpiresAt).toBeNull()
  })
})

describe('User_google_identity_check — a live real account has an identity', () => {
  it('refuses a live real account without a Google subject', async () => {
    const error = await refusal(createUser(db, { isDemo: false, googleSub: null }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('User_google_identity_check')
  })

  it('exempts demo accounts and withdrawn accounts', async () => {
    const demo = await createUser(db, { isDemo: true, googleSub: null })
    const withdrawn = await createUser(db, {
      isDemo: false,
      googleSub: null,
      deletedAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    expect(demo.googleSub).toBeNull()
    expect(withdrawn.googleSub).toBeNull()
  })
})

describe('CommissionRate 의 제약들 — 요율은 정산이 곱하는 값이다', () => {
  /**
   * 범위를 DB 가 강제하는 이유는 `erd.md` 1장이 적어 두었다 — **정산이 이 값을
   * 곱하므로**, 음수나 100% 초과가 들어가면 판매자에게 주문액보다 많은 돈이
   * 계산되고 아무도 눈치채지 못한다.
   */
  it('음수 요율을 거절한다', async () => {
    const user = await createUser(db)
    const error = await refusal(createCommissionRate(db, { createdById: user.id, rateBp: -1 }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('CommissionRate_rate_check')
  })

  it('100% 를 넘는 요율을 거절한다', async () => {
    const user = await createUser(db)
    const error = await refusal(createCommissionRate(db, { createdById: user.id, rateBp: 10_001 }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('CommissionRate_rate_check')
  })

  it.each([0, 10_000])('경계값 %s 는 받는다', async (rateBp) => {
    const user = await createUser(db)
    const rate = await createCommissionRate(db, { createdById: user.id, rateBp })

    expect(rate.rateBp).toBe(rateBp)
  })

  /**
   * **범위는 셋 중 하나다.** 둘 다 채워진 행은 「이 카테고리의 이 판매자」라는 네
   * 번째 범위가 되는데, 그런 것을 만들려면 우선순위 규칙을 다시 정해야 한다 —
   * 표현 불가능하게 두는 편이 낫다.
   */
  it('스토어와 카테고리를 동시에 건 요율을 거절한다', async () => {
    const user = await createUser(db)
    const seller = await createSeller(db, { userId: user.id })
    const category = await createCategory(db)
    const error = await refusal(
      createCommissionRate(db, {
        createdById: user.id,
        sellerId: seller.id,
        categoryId: category.id,
      }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('CommissionRate_scope_check')
  })

  it('기간이 뒤집힌 요율을 거절한다', async () => {
    const user = await createUser(db)
    const error = await refusal(
      createCommissionRate(db, {
        createdById: user.id,
        validFrom: '2026-06-01T00:00:00.000Z',
        validUntil: '2026-01-01T00:00:00.000Z',
      }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('CommissionRate_period_check')
  })

  /**
   * **범위마다 열린 행은 하나뿐이다.** 둘이면 「지금 요율」이 두 개가 되고, 어느
   * 것이 적용될지는 조회의 정렬이 정한다 — 그것은 규칙이 아니라 우연이다.
   */
  it('같은 스토어에 열린 요율이 둘이 될 수 없다', async () => {
    const user = await createUser(db)
    const seller = await createSeller(db, { userId: user.id })

    await createCommissionRate(db, { createdById: user.id, sellerId: seller.id })

    const error = await refusal(
      createCommissionRate(db, { createdById: user.id, sellerId: seller.id }),
    )

    expect(error.code).toBe('23505')
    expect(error.constraint).toBe('CommissionRate_open_seller_key')
  })

  it('전역 요율도 열린 것은 하나뿐이다', async () => {
    const user = await createUser(db)

    await createCommissionRate(db, { createdById: user.id })

    const error = await refusal(createCommissionRate(db, { createdById: user.id }))

    expect(error.code).toBe('23505')
    expect(error.constraint).toBe('CommissionRate_open_global_key')
  })

  /** 닫힌 행은 몇 개든 쌓인다 — 그것이 이력이다. */
  it('닫힌 요율은 몇 개든 남는다', async () => {
    const user = await createUser(db)
    const seller = await createSeller(db, { userId: user.id })

    for (const year of ['2024', '2025']) {
      await createCommissionRate(db, {
        createdById: user.id,
        sellerId: seller.id,
        validFrom: `${year}-01-01T00:00:00.000Z`,
        validUntil: `${year}-12-31T00:00:00.000Z`,
      })
    }

    const rows = await db.query(`SELECT "id" FROM "CommissionRate" WHERE "sellerId" = $1`, [
      seller.id,
    ])

    expect(rows).toHaveLength(2)
  })
})

describe('Settlement 의 제약들 — 정산서는 플랫폼의 장부다', () => {
  /** 한 판매자의 한 회차는 한 장이다. 두 장이면 같은 주가 두 번 지급된다. */
  async function settlement(
    overrides: Partial<{
      status: string
      salesAmount: number
      commissionAmount: number
      sellerCouponAmount: number
      returnAdjustmentAmount: number
      payoutAmount: number
      approvedById: string | null
      periodStart: string
      periodEnd: string
    }> = {},
  ): Promise<string> {
    const owner = await createUser(db)
    const seller = await createSeller(db, { userId: owner.id })
    const values = {
      status: 'PENDING',
      salesAmount: 10_000,
      commissionAmount: 1_000,
      sellerCouponAmount: 0,
      returnAdjustmentAmount: 0,
      payoutAmount: 9_000,
      approvedById: null,
      periodStart: '2026-08-31T00:00:00.000Z',
      periodEnd: '2026-09-07T00:00:00.000Z',
      ...overrides,
    }
    const row = await db.one<{ id: string }>(
      `INSERT INTO "Settlement"
         ("id", "sellerId", "periodStart", "periodEnd", "status", "salesAmount",
          "commissionAmount", "sellerCouponAmount", "returnAdjustmentAmount", "payoutAmount",
          "approvedAt", "approvedById", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2::timestamptz, $3::timestamptz, $4::"SettlementStatus",
               $5, $6, $7, $8, $9,
               CASE WHEN $4 = 'PENDING' THEN NULL ELSE now() END, $10, now())
       RETURNING "id"`,
      [
        seller.id,
        values.periodStart,
        values.periodEnd,
        values.status,
        values.salesAmount,
        values.commissionAmount,
        values.sellerCouponAmount,
        values.returnAdjustmentAmount,
        values.payoutAmount,
        values.approvedById,
      ],
    )

    return row.id
  }

  /**
   * **합계 안의 관계는 DB 가 지킨다** (F8).
   *
   * 줄과 합계 사이의 관계는 SQL 로 강제할 수 없지만, 합계 안에서의 식은 할 수 있다.
   * 이것이 어긋나면 관리자가 승인 화면에서 보는 숫자와 실제로 지급되는 숫자가 다르다.
   */
  it('지급액이 식과 어긋나는 정산서를 거절한다', async () => {
    const error = await refusal(settlement({ payoutAmount: 9_001 }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Settlement_total_check')
  })

  /** 차감은 빼는 값이다. 양수 차감은 「반품으로 돈이 늘었다」가 된다. */
  it('양수 차감을 거절한다', async () => {
    const error = await refusal(settlement({ returnAdjustmentAmount: 1_000, payoutAmount: 10_000 }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Settlement_total_check')
  })

  /**
   * 차감이 판매보다 크면 **지급액이 음수다.** 0으로 자르면 그 차액이 사라지고,
   * 사라진 돈은 아무 데도 나타나지 않는다.
   */
  it('음수 지급액은 받는다', async () => {
    const id = await settlement({ returnAdjustmentAmount: -20_000, payoutAmount: -11_000 })

    expect(id).toBeTruthy()
  })

  /** 「승인됐는데 누가 언제 승인했는지 모른다」는 읽는 사람에게 거짓말이다. */
  it('승인자 없는 승인을 거절한다', async () => {
    const error = await refusal(settlement({ status: 'APPROVED' }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Settlement_status_check')
  })

  it('뒤집힌 기간을 거절한다', async () => {
    const error = await refusal(
      settlement({
        periodStart: '2026-09-07T00:00:00.000Z',
        periodEnd: '2026-08-31T00:00:00.000Z',
      }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Settlement_period_check')
  })
})

describe('StockReservation_quantity_check — 예약은 최소 한 개다', () => {
  it('refuses a reservation of nothing', async () => {
    const error = await refusal(reserve({ quantity: 0 }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('StockReservation_quantity_check')
  })

  it('refuses a negative reservation', async () => {
    const error = await refusal(reserve({ quantity: -1 }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('StockReservation_quantity_check')
  })

  it('allows one', async () => {
    await expect(reserve({ quantity: 1 })).resolves.toBeDefined()
  })
})

describe('ProductVariant_reserved_check — 예약분은 재고를 넘지 못한다', () => {
  it('refuses reserving more than the shelf holds', async () => {
    // 여기가 오버셀을 구조적으로 막는 마지막 줄이다 (D-026). 조건부 갱신이 틀리게
    // 고쳐지더라도 이 제약은 남는다.
    const { variant } = await createSellableVariant(db, { stock: 3 })
    const error = await refusal(setReserved(variant.id, 4))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('ProductVariant_reserved_check')
  })

  it('refuses a negative reserved count', async () => {
    const { variant } = await createSellableVariant(db, { stock: 3 })
    const error = await refusal(setReserved(variant.id, -1))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('ProductVariant_reserved_check')
  })

  it('allows reserving every last one', async () => {
    // 경계다. 전량 예약을 막으면 마지막 한 개는 아무도 살 수 없다.
    const { variant } = await createSellableVariant(db, { stock: 3 })

    await expect(setReserved(variant.id, 3)).resolves.toBeDefined()
  })

  it('refuses taking the shelf below what is already held', async () => {
    // 반대 방향. 판매자가 재고를 3에서 1로 내리는데 2개가 잡혀 있으면, 그것을
    // 허용하는 순간 잡힌 사람 둘 중 하나는 살 수 없는 것을 산 셈이 된다.
    const { variant } = await createSellableVariant(db, { stock: 3 })

    await setReserved(variant.id, 2)

    const error = await refusal(
      db.query(`UPDATE "ProductVariant" SET "stock" = 1 WHERE "id" = $1`, [variant.id]),
    )

    expect(error.constraint).toBe('ProductVariant_reserved_check')
  })
})

/** 예약 한 줄을 날 SQL 로 넣는다 — 애플리케이션이 먼저 답하지 않게. */
async function reserve(options: { readonly quantity: number }): Promise<unknown> {
  const user = await createUser(db)
  const { variant } = await createSellableVariant(db, { stock: 10 })

  return db.query(
    `INSERT INTO "StockReservation"
       ("id", "variantId", "userId", "checkoutId", "quantity", "expiresAt", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, gen_random_uuid(), $3, now() + interval '15 minutes', now())`,
    [variant.id, user.id, options.quantity],
  )
}

function setReserved(variantId: string, reserved: number): Promise<unknown> {
  return db.query(`UPDATE "ProductVariant" SET "reserved" = $2 WHERE "id" = $1`, [
    variantId,
    reserved,
  ])
}

describe('Order_orderNumber_format_check — 주문번호의 형식', () => {
  it('refuses a number a person could not read back', async () => {
    // 생성기가 하나가 아니게 되는 날 — 시드, 백필, 다른 서비스 — 형식이 조용히
    // 갈라진다. 그때 「전화로 불러 줄 수 있는 번호」라는 성질이 사라진다.
    const error = await refusal(order({ orderNumber: '20260905-ILOU0000' }))

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('Order_orderNumber_format_check')
  })

  it('refuses a bare uuid', async () => {
    const error = await refusal(order({ orderNumber: randomUUID() }))

    expect(error.constraint).toBe('Order_orderNumber_format_check')
  })

  it('allows the shape the generator makes', async () => {
    await expect(order({ orderNumber: '20260905-0123456Z' })).resolves.toBeDefined()
  })
})

describe('Order_orderNumber_key — 같은 번호는 두 번 쓰이지 않는다', () => {
  it('refuses the second order with a number already taken', async () => {
    // 서비스는 겹치면 트랜잭션을 통째로 다시 한다. 다시 할 이유가 실제로
    // 존재한다는 것이 이 검사다 — 40비트는 넓지만 무한하지 않다.
    await order({ orderNumber: '20260905-AAAAAAAA' })

    const error = await refusal(order({ orderNumber: '20260905-AAAAAAAA' }))

    expect(error.code).toBe('23505')
    expect(error.constraint).toBe('Order_orderNumber_key')
  })
})

describe('OrderItem_discount_bound_check — 항목의 할인은 그 항목의 값을 넘지 못한다', () => {
  it('refuses a discount larger than the line it is on', async () => {
    // TASK-0047 F8 이 무작위 1000회로 잡은 결함이 정확히 이 위반이었다 —
    // 적립금이 배송비를 낸 몫까지 항목에 안분돼 부분 취소의 환불액이 음수가 됐다.
    // 그때는 코드로 고쳤고, 여기서는 DB 가 막는다.
    const error = await refusal(
      orderItem({ productAmount: 10_000, couponDiscountAmount: 11_000, discountAmount: 11_000 }),
    )

    expect(error.code).toBe('23514')
    expect(error.constraint).toBe('OrderItem_discount_bound_check')
  })

  it('allows a discount that takes the line to zero', async () => {
    // 경계다. 전액 할인을 막으면 100% 쿠폰이 표현 불가능해진다.
    await expect(
      orderItem({ productAmount: 10_000, couponDiscountAmount: 10_000, discountAmount: 10_000 }),
    ).resolves.toBeDefined()
  })

  it('refuses a total that is not the sum of its parts', async () => {
    const error = await refusal(
      orderItem({ productAmount: 10_000, couponDiscountAmount: 1_000, discountAmount: 2_000 }),
    )

    expect(error.constraint).toBe('OrderItem_discount_sum_check')
  })
})

describe('Seller_shipping_check — 배송 정책의 값', () => {
  it('refuses a negative shipping fee', async () => {
    const user = await createUser(db)
    const seller = await createSeller(db, { userId: user.id })
    const error = await refusal(
      db.query(`UPDATE "Seller" SET "shippingFee" = -1 WHERE "id" = $1`, [seller.id]),
    )

    expect(error.constraint).toBe('Seller_shipping_check')
  })

  it('allows a threshold of zero and a threshold of none', async () => {
    // 둘 다 유효하고 **뜻이 다르다** — `0` 은 「언제나 무료」, `NULL` 은 「무료
    // 조건이 없다」다.
    const user = await createUser(db)
    const seller = await createSeller(db, { userId: user.id })

    await expect(
      db.query(`UPDATE "Seller" SET "freeShippingThreshold" = 0 WHERE "id" = $1`, [seller.id]),
    ).resolves.toBeDefined()
    await expect(
      db.query(`UPDATE "Seller" SET "freeShippingThreshold" = NULL WHERE "id" = $1`, [seller.id]),
    ).resolves.toBeDefined()
  })
})

/** 주문 한 줄을 날 SQL 로. 애플리케이션이 먼저 답하지 않게. */
async function order(options: { readonly orderNumber: string }): Promise<unknown> {
  const user = await createUser(db)

  return db.query(
    `INSERT INTO "Order"
       ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
        "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, gen_random_uuid(), '수령인', '010-0000-0000',
             '06234', '서울시 강남구', 10000, 10000, now())`,
    [options.orderNumber, user.id],
  )
}

/** 주문 항목 한 줄. 그 위의 주문과 판매자 몫까지 만든다. */
async function orderItem(amounts: {
  readonly productAmount: number
  readonly couponDiscountAmount: number
  readonly discountAmount: number
}): Promise<unknown> {
  const { seller, variant } = await createSellableVariant(db, { stock: 10 })
  const user = await createUser(db)
  const created = await db.one<{ id: string }>(
    `INSERT INTO "Order"
       ("id", "orderNumber", "userId", "checkoutId", "recipientName", "recipientPhone",
        "postalCode", "addressLine1", "totalProductAmount", "paidAmount", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, gen_random_uuid(), '수령인', '010-0000-0000',
             '06234', '서울시 강남구', $3, $3, now())
     RETURNING "id"`,
    [
      `20260905-${randomUUID()
        .replaceAll('-', '')
        .slice(0, 8)
        .toUpperCase()
        .replaceAll(/[ILOU]/gu, 'X')}`,
      user.id,
      amounts.productAmount,
    ],
  )
  const sellerOrder = await db.one<{ id: string }>(
    `INSERT INTO "SellerOrder"
       ("id", "orderId", "sellerId", "brandName", "productAmount", "paidAmount", "updatedAt")
     VALUES (gen_random_uuid(), $1, $2, '브랜드', $3, $3, now())
     RETURNING "id"`,
    [created.id, seller.id, amounts.productAmount],
  )

  return db.query(
    `INSERT INTO "OrderItem"
       ("id", "sellerOrderId", "variantId", "productId", "productSnapshot", "unitPrice",
        "quantity", "productAmount", "couponDiscountAmount", "discountAmount",
        "commissionRateBp", "updatedAt")
     SELECT gen_random_uuid(), $1, $2, pv."productId", '{}'::jsonb, $3, 1, $3, $4, $5, 1000, now()
       FROM "ProductVariant" pv WHERE pv."id" = $2`,
    [
      sellerOrder.id,
      variant.id,
      amounts.productAmount,
      amounts.couponDiscountAmount,
      amounts.discountAmount,
    ],
  )
}
