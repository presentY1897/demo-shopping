import type { DemoRole } from '@shopping/shared'
import { describe, expect, it, vi } from 'vitest'
import {
  claimResponseSchema,
  sellerOrderTransitionResponseSchema,
  shipmentResponseSchema,
  settlementResponseSchema,
} from '@shopping/shared'
import { VirtualCardService } from '../../src/payment/virtual-card.service.js'

import { DemoService } from '../../src/demo/demo.service.js'
import { DemoCleanupService } from '../../src/demo/demo-cleanup.service.js'
import { PrismaService } from '../../src/prisma/prisma.service.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import {
  createCategory,
  createProduct,
  createProductVariant,
  createSeller,
  createUser,
} from '../support/factories.js'

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

async function catalogue(): Promise<string> {
  const user = await createUser(db)
  const seller = await createSeller(db, { userId: user.id, status: 'ACTIVE' })
  const category = await createCategory(db)
  const product = await createProduct(db, {
    sellerId: seller.id,
    categoryId: category.id,
    minPrice: 12000,
    status: 'ACTIVE',
  })
  return (
    await createProductVariant(db, {
      sellerId: seller.id,
      productId: product.id,
      stock: 20,
      price: 12_000,
    })
  ).id
}

async function issue(role: DemoRole): Promise<string> {
  await api
    .resolve<DemoService>(DemoService)
    .issue(role, role === 'BUYER' ? 'shop' : role === 'SELLER' ? 'seller' : 'admin')
  const [row] = await db.query<{ id: string }>(
    `SELECT "id" FROM "User" WHERE "email" LIKE $1 AND "email" NOT LIKE '%trade@%' ORDER BY "id" DESC LIMIT 1`,
    [`${role.toLowerCase()}-%@demo.demo-shopping.com`],
  )
  if (row === undefined) throw new Error('발급 계정이 없습니다.')
  return row.id
}

describe('role-specific demo trade fixtures', () => {
  it.each([
    ['BUYER', 3, 0, 0],
    ['SELLER', 5, 2, 0],
    ['ADMIN', 2, 1, 1],
  ] as const)(
    '%s creates complete trade graphs and preserves originals',
    async (role, orders, settlements, claims) => {
      const originalId = await catalogue()
      await issue(role)
      const prisma = api.resolve<PrismaService>(PrismaService)
      expect(await prisma.order.count()).toBe(orders)
      expect(await prisma.sellerOrder.count()).toBe(orders)
      expect(await prisma.payment.count({ where: { status: 'PAID' } })).toBe(orders)
      expect(await prisma.stockReservation.count({ where: { status: 'CONFIRMED' } })).toBe(orders)
      expect(await prisma.settlement.count()).toBe(settlements)
      expect(await prisma.claimRequest.count()).toBe(claims)
      expect(
        (await prisma.productVariant.findUniqueOrThrow({ where: { id: originalId } })).stock,
      ).toBe(20)
      const cards = await prisma.virtualCard.findMany({
        include: { entries: { orderBy: { createdAt: 'asc' } } },
      })
      for (const card of cards) {
        expect(card.usedAmount).toBe(card.entries.reduce((sum, entry) => sum + entry.amount, 0))
        expect(card.usedAmount).toBeLessThanOrEqual(card.creditLimit / 2)
        let balance = 0
        for (const entry of card.entries) {
          balance += entry.amount
          expect(entry.balanceAfter).toBe(balance)
        }
      }
      const copies = await prisma.productVariant.findMany({
        where: { id: { not: originalId } },
        include: { ledger: true },
      })
      for (const copy of copies) {
        expect(copy.stock).toBe(copy.ledger.reduce((sum, entry) => sum + entry.quantity, 0))
        expect(copy.reserved).toBe(0)
      }
      const confirmed = await prisma.sellerOrder.count({ where: { status: 'CONFIRMED' } })
      expect(await prisma.pointTransaction.count({ where: { refType: 'SELLER_ORDER' } })).toBe(
        confirmed,
      )
    },
  )

  it('expires helper accounts together without foreign-key failures', async () => {
    await catalogue()
    await issue('ADMIN')
    api.clock.advance(25 * 3_600_000)
    const report = await api.resolve<DemoCleanupService>(DemoCleanupService).sweep()
    expect(report).toMatchObject({ failed: 0 })
    const prisma = api.resolve<PrismaService>(PrismaService)
    expect(
      await prisma.user.count({ where: { demoExpiresAt: { not: null }, deletedAt: null } }),
    ).toBe(0)
  })
})

describe('example orders remain actionable through the real API', () => {
  it('buyer cancels a paid example and confirms a delivered example', async () => {
    await catalogue()
    const userId = await issue('BUYER')
    const prisma = api.resolve<PrismaService>(PrismaService)
    const buyer = api.clientAs({ userId, roles: ['BUYER'] })
    const paid = await prisma.sellerOrder.findFirstOrThrow({
      where: { order: { userId }, status: 'PAID' },
      include: { items: true },
    })
    const cardBefore = await prisma.virtualCard.findFirstOrThrow({ where: { userId } })
    const { claim } = await buyer.request({
      path: '/claims',
      method: 'POST',
      body: {
        sellerOrderId: paid.id,
        items: paid.items.map((item) => ({ orderItemId: item.id, quantity: 1 })),
        reason: '체험 주문을 취소합니다.',
        fault: 'CUSTOMER',
      },
      schema: claimResponseSchema,
    })
    expect(claim.status).toBe('REFUNDED')
    const cardAfter = await prisma.virtualCard.findUniqueOrThrow({ where: { id: cardBefore.id } })
    expect(cardAfter.usedAmount).toBe(cardBefore.usedAmount - paid.paidAmount)
    const delivered = await prisma.sellerOrder.findFirstOrThrow({
      where: { order: { userId }, status: 'DELIVERED' },
    })
    expect(
      await buyer.request({
        path: `/seller-orders/${delivered.id}/transitions`,
        method: 'POST',
        body: { to: 'CONFIRMED' },
        schema: sellerOrderTransitionResponseSchema,
      }),
    ).toMatchObject({ status: 'CONFIRMED', changed: true })
    expect(
      await prisma.pointTransaction.count({
        where: { refType: 'SELLER_ORDER', refId: delivered.id },
      }),
    ).toBe(1)
  })

  it('seller prepares and ships an example with a valid tracking record', async () => {
    await catalogue()
    const userId = await issue('SELLER')
    const prisma = api.resolve<PrismaService>(PrismaService)
    const store = await prisma.seller.findUniqueOrThrow({ where: { userId } })
    const seller = api.clientAs({ userId, sellerId: store.id, roles: ['SELLER_OWNER'] })
    const order = await prisma.sellerOrder.findFirstOrThrow({
      where: { sellerId: store.id, status: 'PAID' },
    })
    expect(
      await seller.request({
        path: `/seller-orders/${order.id}/transitions`,
        method: 'POST',
        body: { to: 'PREPARING' },
        schema: sellerOrderTransitionResponseSchema,
      }),
    ).toMatchObject({ status: 'PREPARING', changed: true })
    const shipped = await seller.request({
      path: `/seller-orders/${order.id}/shipment`,
      method: 'POST',
      body: {},
      schema: shipmentResponseSchema,
    })
    expect(shipped.shipment.trackingNumber).toMatch(/^DEMO-/u)
    expect((await prisma.sellerOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'SHIPPED',
    )
  })

  it('demo admin handles the example return and approves its settlement', async () => {
    await catalogue()
    const userId = await issue('ADMIN')
    const prisma = api.resolve<PrismaService>(PrismaService)
    const admin = api.clientAs({ userId, roles: ['DEMO_ADMIN'] })
    const claim = await prisma.claimRequest.findFirstOrThrow({
      include: { items: true, statusHistory: { orderBy: { createdAt: 'asc' } } },
    })
    expect(claim.status).toBe('RETURN_REJECTED')
    expect(claim.statusHistory.map((entry) => entry.toStatus)).toEqual([
      'RETURN_REQUESTED',
      'RETURN_REJECTED',
    ])
    const item = await prisma.orderItem.findUniqueOrThrow({
      where: { id: claim.items[0]!.orderItemId },
    })
    expect(item.claimedQuantity).toBe(0)
    expect(
      await admin.request({
        path: '/admin/claims',
        method: 'POST',
        body: {
          sellerOrderId: claim.sellerOrderId,
          items: [{ orderItemId: item.id, quantity: 1 }],
          reason: '체험 반품 조건을 재검토해 승인합니다.',
          fault: null,
          return: { returnReason: 'CHANGE_OF_MIND', photoKeys: [] },
          overturnsClaimId: claim.id,
        },
        schema: claimResponseSchema,
      }),
    ).toMatchObject({ claim: { status: 'RETURN_APPROVED', overturnsClaimId: claim.id } })
    const settlement = await prisma.settlement.findFirstOrThrow()
    expect(
      await admin.request({
        path: `/settlements/${settlement.id}/approval`,
        method: 'POST',
        schema: settlementResponseSchema,
      }),
    ).toMatchObject({ settlement: { status: 'APPROVED' } })
  })

  it('demo approval cannot mutate real settlements or confirm any payout', async () => {
    const originalId = await catalogue()
    const userId = await issue('ADMIN')
    const prisma = api.resolve<PrismaService>(PrismaService)
    const original = await prisma.productVariant.findUniqueOrThrow({ where: { id: originalId } })
    const real = await prisma.settlement.create({
      data: {
        sellerId: original.sellerId,
        periodStart: new Date('2026-08-17T15:00:00Z'),
        periodEnd: new Date('2026-08-24T15:00:00Z'),
        salesAmount: 10000,
        commissionAmount: 300,
        sellerCouponAmount: 0,
        returnAdjustmentAmount: 0,
        payoutAmount: 9700,
      },
    })
    const demo = await prisma.settlement.findFirstOrThrow({ where: { id: { not: real.id } } })
    const admin = api.clientAs({ userId, roles: ['DEMO_ADMIN'] })
    for (const [path, body] of [
      [`/settlements/${real.id}/approval`, {}],
      [`/settlements/${real.id}/hold`, { reason: '권한 격리 검사' }],
      ['/settlements/approvals', { ids: [demo.id, real.id] }],
      [`/settlements/${demo.id}/payment`, {}],
    ] as const) {
      await expect(
        admin.request({ path, method: 'POST', body, schema: settlementResponseSchema }),
      ).rejects.toMatchObject({ status: 403 })
    }
    expect(await prisma.settlement.count({ where: { status: 'PENDING' } })).toBe(2)
  })

  it('a failure on the second example charge rolls back every helper and ledger', async () => {
    const originalId = await catalogue()
    const cards = api.resolve<VirtualCardService>(VirtualCardService)
    const charge = cards.chargeWithin.bind(cards)
    let calls = 0
    const spy = vi.spyOn(cards, 'chargeWithin').mockImplementation(async (...args) => {
      calls += 1
      if (calls === 2) throw new Error('forced second charge failure')
      return charge(...args)
    })
    try {
      await expect(issue('SELLER')).rejects.toThrow('forced second charge failure')
    } finally {
      spy.mockRestore()
    }
    const prisma = api.resolve<PrismaService>(PrismaService)
    expect(await prisma.user.count({ where: { demoExpiresAt: { not: null } } })).toBe(0)
    expect(await prisma.order.count()).toBe(0)
    expect(await prisma.virtualCardTransaction.count()).toBe(0)
    expect(await prisma.stockLedger.count()).toBe(0)
    expect(
      (await prisma.productVariant.findUniqueOrThrow({ where: { id: originalId } })).stock,
    ).toBe(20)
  })
})
