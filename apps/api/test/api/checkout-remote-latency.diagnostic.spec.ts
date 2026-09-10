import { setTimeout as delay } from 'node:timers/promises'
import { writeFile } from 'node:fs/promises'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  cartResponseSchema,
  checkoutResponseSchema,
  orderResponseSchema,
  paymentResponseSchema,
} from '@shopping/shared'
import { VirtualCardService } from '../../src/payment/virtual-card.service.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import {
  createUser,
  createAddress,
  createCategory,
  createSeller,
  createProduct,
  createProductVariant,
} from '../support/factories.js'

// Opt-in, isolated PostgreSQL only. Delay responses, never production queries.
describe.skipIf(process.env.CHECKOUT_REMOTE_DIAGNOSTIC !== '1')(
  'remote database transaction diagnostic',
  () => {
    const db = useDatabase()
    const pool = new Pool({ connectionString: db.url, max: 5 })
    const timeout = Number(process.env.CHECKOUT_REMOTE_TX_TIMEOUT_MS ?? '5000')
    const prisma = new PrismaClient({
      adapter: new PrismaPg(pool),
      transactionOptions: { timeout },
    })
    const api = useApiApp({ database: db, authenticate: true, prisma })
    let enabled = false
    let queries = 0
    const transactionErrors: string[] = []
    const delayMs = 210
    beforeAll(() => {
      const transaction = Reflect.get(prisma, '$transaction') as (
        ...args: unknown[]
      ) => Promise<unknown>
      Reflect.set(prisma, '$transaction', function (this: unknown, ...args: unknown[]) {
        return Reflect.apply(transaction, this, args).catch((error: unknown) => {
          if (
            enabled &&
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            typeof error.code === 'string' &&
            /^P[0-9]{4}$/.test(error.code)
          )
            transactionErrors.push(error.code)
          throw error
        })
      })
      const tracked = new WeakSet<object>()
      const track = (client: object) => {
        if (tracked.has(client)) return
        tracked.add(client)
        const original = Reflect.get(client, 'query') as (...args: unknown[]) => unknown
        Reflect.set(client, 'query', function (this: unknown, ...args: unknown[]) {
          if (!enabled) return Reflect.apply(original, this, args)
          queries++
          const callback = args.at(-1)
          if (typeof callback === 'function')
            args[args.length - 1] = function (this: unknown, ...values: unknown[]) {
              void delay(delayMs).then(() => {
                Reflect.apply(callback as (...args: unknown[]) => unknown, this, values)
              })
            }
          const result = Reflect.apply(original, this, args)
          if (result instanceof Promise)
            return (result as Promise<unknown>).then(async (value) => {
              await delay(delayMs)
              return value
            })
          return result
        })
      }
      pool.on('connect', track)
      pool.on('acquire', track)
    })
    afterAll(async () => {
      await prisma.$disconnect()
      await pool.end()
    })
    it('records completion or transaction failure for two sellers and two items', async () => {
      const buyer = await createUser(db)
      const address = await createAddress(db, { userId: buyer.id, isDefault: true })
      const card = await api
        .resolve<VirtualCardService>(VirtualCardService)
        .issueFor(buyer.id, 1_000_000)
      const client = api.clientAs({ userId: buyer.id, roles: ['BUYER'] })
      const itemIds: string[] = []
      for (let i = 0; i < 2; i++) {
        const owner = await createUser(db)
        const seller = await createSeller(db, { userId: owner.id })
        const category = await createCategory(db)
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
          stock: 10,
          isActive: true,
        })
        const cart = await client.request({
          path: '/cart/items',
          method: 'POST',
          body: { variantId: variant.id, quantity: 1 },
          schema: cartResponseSchema,
        })
        itemIds.splice(
          0,
          itemIds.length,
          ...cart.groups.flatMap((g) => g.items.map((item) => item.id)),
        )
      }
      const { checkout } = await client.request({
        path: '/checkouts',
        method: 'POST',
        body: { itemIds },
        schema: checkoutResponseSchema,
      })
      const { order } = await client.request({
        path: '/orders',
        method: 'POST',
        body: { checkoutId: checkout.id, addressId: address.id },
        schema: orderResponseSchema,
      })
      const { payment } = await client.request({
        path: '/payments',
        method: 'POST',
        body: { orderId: order.id, provider: 'VIRTUAL_CARD', cardId: card.id },
        schema: paymentResponseSchema,
      })
      await client.request({
        path: `/payments/${payment.id}/authorize`,
        method: 'POST',
        schema: paymentResponseSchema,
      })
      const start = performance.now()
      let status: number
      enabled = true
      try {
        // Use raw HTTP so the shared client's 5s budget cannot mask the server result.
        const result = await fetch(`${api.baseUrl}/api/v1/payments/${payment.id}/capture`, {
          method: 'POST',
          headers: { 'X-Test-User': buyer.id, 'X-Test-Roles': 'BUYER', 'X-App-Id': 'shop' },
        })
        status = result.status
      } finally {
        enabled = false
      }
      const ms = performance.now() - start
      const saved = await prisma.payment.findUniqueOrThrow({
        where: { id: payment.id },
        select: { status: true },
      })
      const orders = await prisma.sellerOrder.findMany({
        where: { orderId: order.id },
        select: { status: true },
      })
      const cart = await client.request({ path: '/cart', schema: cartResponseSchema })
      const result = {
        environment:
          'isolated local PostgreSQL; two sellers/items; simulated response delay only during capture',
        delayMs,
        timeout,
        status,
        ms,
        queries,
        transactionErrors,
        paymentStatus: saved.status,
        sellerStatuses: orders.map((o) => o.status),
        cartItemCount: cart.itemCount,
      }
      await writeFile(
        process.env.CHECKOUT_REMOTE_OUTPUT ?? '/tmp/checkout-remote-diagnostic.json',
        JSON.stringify(result, null, 2) + '\n',
      )
      if (timeout === 5000) {
        expect(status).toBe(500)
        expect(transactionErrors).toContain('P2028')
        expect(result.sellerStatuses).toEqual(['PAYMENT_PENDING', 'PAYMENT_PENDING'])
        expect(cart.itemCount).toBe(2)
      } else {
        expect(status).toBe(201)
        expect(result.sellerStatuses).toEqual(['PAID', 'PAID'])
        expect(cart.itemCount).toBe(0)
      }
      expect(saved.status).toBe('PAID')
    }, 90_000)
  },
)
