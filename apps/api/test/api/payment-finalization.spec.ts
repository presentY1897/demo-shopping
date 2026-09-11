import { randomUUID } from 'node:crypto'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { checkoutResponseSchema, orderResponseSchema } from '@shopping/shared'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { PaymentService } from '../../src/payment/payment.service.js'
import { VirtualCardService } from '../../src/payment/virtual-card.service.js'
import { OrderService } from '../../src/orders/order.service.js'
import { SellerOrderService } from '../../src/orders/seller-order.service.js'
import { ReservationService } from '../../src/reservation/reservation.service.js'
import { StockService } from '../../src/stock/stock.service.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import {
  createAddress,
  createCategory,
  createProduct,
  createProductVariant,
  createSeller,
  createStockLedgerEntry,
  createUser,
} from '../support/factories.js'

const db = useDatabase()
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: db.url, max: 5 }),
  log: [{ emit: 'event', level: 'query' }],
})
const api = useApiApp({ database: db, authenticate: true, prisma })
const statements: string[] = []
prisma.$on('query', (event) => statements.push(event.query))
afterAll(() => prisma.$disconnect())
const orders = () => api.resolve<OrderService>(OrderService)
const reservations = () => api.resolve<ReservationService>(ReservationService)
const stock = () => api.resolve<StockService>(StockService)

async function fixture(count: number) {
  const buyer = await createUser(db)
  const address = await createAddress(db, { userId: buyer.id })
  const category = await createCategory(db)
  const variants: string[] = []
  for (let index = 0; index < count; index++) {
    const owner = await createUser(db)
    const seller = await createSeller(db, { userId: owner.id })
    const product = await createProduct(db, {
      sellerId: seller.id,
      categoryId: category.id,
      status: 'ACTIVE',
      minPrice: 1000,
    })
    const variant = await createProductVariant(db, {
      sellerId: seller.id,
      productId: product.id,
      price: 1000,
      stock: 1,
    })
    await createStockLedgerEntry(db, { variantId: variant.id, quantity: 1, balanceAfter: 1 })
    variants.push(variant.id)
  }
  const cart = await prisma.cart.create({
    data: {
      userId: buyer.id,
      items: {
        create: variants.map((variantId) => ({
          variant: { connect: { id: variantId } },
          quantity: 1,
          priceAtAdded: 1000,
        })),
      },
    },
    include: { items: true },
  })
  const client = api.clientAs({ userId: buyer.id, roles: ['BUYER'] })
  statements.length = 0
  const { checkout } = await client.request({
    path: '/checkouts',
    method: 'POST',
    body: { itemIds: cart.items.map((row) => row.id) },
    schema: checkoutResponseSchema,
  })
  const checkoutSql = [...statements]
  statements.length = 0
  const { order } = await client.request({
    path: '/orders',
    method: 'POST',
    body: { checkoutId: checkout.id, addressId: address.id },
    schema: orderResponseSchema,
  })
  const orderSql = [...statements]
  await prisma.searchOutbox.deleteMany()
  return {
    orderId: order.id,
    checkoutId: checkout.id,
    buyerId: buyer.id,
    variants,
    cartId: cart.id,
    checkoutSql,
    orderSql,
  }
}

async function assertComplete(placed: Awaited<ReturnType<typeof fixture>>, count: number) {
  expect(await prisma.cartItem.count({ where: { cartId: placed.cartId } })).toBe(0)
  expect(
    await prisma.sellerOrder.count({ where: { orderId: placed.orderId, status: 'PAID' } }),
  ).toBe(count)
  expect(
    await prisma.orderStatusHistory.count({
      where: { sellerOrder: { orderId: placed.orderId }, toStatus: 'PAID' },
    }),
  ).toBe(count)
  expect(
    await prisma.stockLedger.count({
      where: { variantId: { in: placed.variants }, type: 'RESERVE_CONFIRM' },
    }),
  ).toBe(count)
  expect(await stock().reconcile()).toEqual([])
  expect(await reservations().reconcile()).toEqual([])
}

describe('payment finalization batches', () => {
  it.each([1, 2, 100])(
    'bounds transaction SQL for %i sellers/items including sold-out outbox',
    async (count) => {
      const placed = await fixture(count)
      expect(
        placed.checkoutSql.filter(
          (sql) => sql.includes('INSERT INTO') && sql.includes('"StockReservation"'),
        ),
      ).toHaveLength(1)
      for (const table of ['SellerOrder', 'OrderItem', 'OrderStatusHistory']) {
        expect(
          placed.orderSql.filter(
            (sql) => sql.includes('INSERT INTO') && sql.includes(`"${table}"`),
          ),
        ).toHaveLength(1)
      }
      statements.length = 0
      await orders().markPaid(placed.orderId)
      const seen = [...statements]
      const begin = seen.findIndex(
        (sql) => sql.includes('FROM "Order"') && sql.includes('FOR UPDATE'),
      )
      const commit = seen.findIndex(
        (sql) => sql.includes('INSERT INTO') && sql.includes('"OrderStatusHistory"'),
      )
      expect(begin).toBeGreaterThanOrEqual(0)
      expect(commit).toBeGreaterThan(begin)
      // Prisma query events exclude adapter BEGIN/COMMIT; include those two round trips.
      expect(seen.slice(begin, commit + 1).length + 2).toBeLessThanOrEqual(20)
      await assertComplete(placed, count)
      expect(await prisma.searchOutbox.count()).toBe(count)
    },
    60_000,
  )

  it('concurrent completion and retries append each ledger/history once', async () => {
    const placed = await fixture(2)
    await Promise.all([orders().markPaid(placed.orderId), orders().markPaid(placed.orderId)])
    await orders().markPaid(placed.orderId)
    await assertComplete(placed, 2)
  })

  it('rolls back stock, outbox, cleanup and histories, then finishes on retry', async () => {
    const placed = await fixture(2)
    const transitions = api.resolve<SellerOrderService>(SellerOrderService)
    const original = transitions.payPendingWithin.bind(transitions)
    const failure = vi
      .spyOn(transitions, 'payPendingWithin')
      .mockImplementationOnce(async (...args) => {
        await original(...args)
        throw new Error('injected after history write')
      })
    await expect(orders().markPaid(placed.orderId)).rejects.toThrow('injected after history write')
    failure.mockRestore()
    expect(await prisma.cartItem.count({ where: { cartId: placed.cartId } })).toBe(2)
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: placed.orderId } })).cartCleanedAt,
    ).toBeNull()
    expect(
      await prisma.stockReservation.count({
        where: { checkoutId: placed.checkoutId, status: 'HELD' },
      }),
    ).toBe(2)
    expect(await prisma.stockLedger.count({ where: { type: 'RESERVE_CONFIRM' } })).toBe(0)
    expect(await prisma.orderStatusHistory.count({ where: { toStatus: 'PAID' } })).toBe(0)
    expect(await prisma.searchOutbox.count()).toBe(0)
    expect(await stock().reconcile()).toEqual([])
    expect(await reservations().reconcile()).toEqual([])
    await orders().markPaid(placed.orderId)
    await assertComplete(placed, 2)
  })

  it('refuses a reservation released while completion waits for its lock', async () => {
    const placed = await fixture(2)
    const held = await prisma.stockReservation.findFirstOrThrow({
      where: { checkoutId: placed.checkoutId },
    })
    let complete: Promise<unknown> | undefined
    await prisma.$transaction(async (tx) => {
      await reservations().release(tx, held.id)
      complete = orders()
        .markPaid(placed.orderId)
        .then(
          () => null,
          (error: unknown) => error,
        )
      await vi.waitFor(async () => {
        const waiting = await db.one<{ count: number }>(
          `SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE '%StockReservation%'`,
        )
        expect(waiting.count).toBeGreaterThan(0)
      })
    })
    const error = (await complete) as { getResponse: () => unknown }
    expect(error.getResponse()).toMatchObject({ code: 'RESERVATION_RELEASED' })
    expect(
      await prisma.sellerOrder.count({
        where: { orderId: placed.orderId, status: 'PAYMENT_PENDING' },
      }),
    ).toBe(2)
    expect(await prisma.cartItem.count({ where: { cartId: placed.cartId } })).toBe(2)
    expect(await prisma.stockLedger.count({ where: { type: 'RESERVE_CONFIRM' } })).toBe(0)
    expect(await stock().reconcile()).toEqual([])
    expect(await reservations().reconcile()).toEqual([])
  })

  it('reads the committed ledger position after waiting for a variant lock', async () => {
    const placed = await fixture(1)
    const variantId = placed.variants[0]!
    let complete: Promise<void> | undefined
    await db.withConnection(async (connection) => {
      await connection.query('BEGIN')
      try {
        await connection.query('SELECT "id" FROM "ProductVariant" WHERE "id" = $1 FOR UPDATE', [
          variantId,
        ])
        complete = orders().markPaid(placed.orderId)
        // Establish actual lock contention before changing the row/ledger.
        await vi.waitFor(async () => {
          const waiting = await db.one<{ count: number }>(
            `SELECT count(*)::int AS count FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'
                AND query LIKE '%ProductVariant%'`,
          )
          expect(waiting.count).toBeGreaterThan(0)
        })
        await connection.query('UPDATE "ProductVariant" SET "stock" = 2 WHERE "id" = $1', [
          variantId,
        ])
        await connection.query(
          `INSERT INTO "StockLedger"
          ("variantId", "seq", "type", "quantity", "balanceAfter") VALUES ($1, 2, 'INBOUND', 1, 2)`,
          [variantId],
        )
        await connection.query('COMMIT')
      } catch (error) {
        await connection.query('ROLLBACK')
        await complete?.catch(() => undefined)
        throw error
      }
    })
    await complete
    await assertComplete(placed, 1)
    expect(
      await prisma.stockLedger.findUnique({
        where: { variantId_seq: { variantId, seq: 3 } },
        select: { quantity: true, balanceAfter: true },
      }),
    ).toEqual({ quantity: -1, balanceAfter: 1 })
  })

  it('maintains contiguous balances for multiple holds of one variant', async () => {
    const placed = await fixture(1)
    const variantId = placed.variants[0]!
    await stock().adjust({ variantId, type: 'INBOUND', quantity: 4 })
    const checkoutId = randomUUID()
    for (const quantity of [1, 2]) {
      await reservations().hold({ variantId, quantity, userId: placed.buyerId, checkoutId })
    }
    await Promise.all([
      prisma.$transaction((tx) => reservations().confirmCheckout(tx, checkoutId)),
      prisma.$transaction((tx) => reservations().confirmCheckout(tx, checkoutId)),
    ])
    expect(await stock().reconcile()).toEqual([])
    expect(await reservations().reconcile()).toEqual([])
    expect(await prisma.stockLedger.count({ where: { type: 'RESERVE_CONFIRM' } })).toBe(2)
    expect(
      await prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { stock: true, reserved: true },
      }),
    ).toEqual({ stock: 2, reserved: 1 })
  })
})

describe('payment read roundtrips (TASK-0135)', () => {
  it('bounds all three payment stages and reads the full response in one statement', async () => {
    const placed = await fixture(2)
    const card = await api
      .resolve<VirtualCardService>(VirtualCardService)
      .issueFor(placed.buyerId, 1000000)
    const principal = {
      app: 'shop',
      userId: placed.buyerId,
      roles: ['BUYER'],
      sellerId: null,
    } as const
    const payments = api.resolve<PaymentService>(PaymentService)
    statements.length = 0
    const { payment } = await payments.start(principal, placed.orderId, 'VIRTUAL_CARD', {
      methodRef: card.id,
    })
    expect(statements.length).toBeLessThanOrEqual(10)
    statements.length = 0
    await payments.authorize(principal, payment.id)
    expect(statements.length).toBeLessThanOrEqual(15)
    statements.length = 0
    const captured = await payments.capture(principal, payment.id)
    expect(statements.length).toBeLessThanOrEqual(26)
    expect(captured.payment.status).toBe('PAID')
    await assertComplete(placed, 2)
    statements.length = 0
    expect(await payments.get(principal, payment.id)).toEqual(captured)
    expect(statements).toHaveLength(1)
  })
})
