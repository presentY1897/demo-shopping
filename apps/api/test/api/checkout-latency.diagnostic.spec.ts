import { AsyncLocalStorage } from 'node:async_hooks'
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
import { CartService } from '../../src/cart/cart.service.js'
import { CheckoutService } from '../../src/orders/checkout.service.js'
import { OrderService } from '../../src/orders/order.service.js'
import { PaymentService } from '../../src/payment/payment.service.js'
import { VirtualCardService } from '../../src/payment/virtual-card.service.js'
import { PaymentProviderRegistry } from '../../src/payment/payment-registry.js'
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

// Opt-in diagnostic, isolated worker DB only. No SQL, parameters or user data leave this process.
describe.skipIf(process.env.CHECKOUT_LATENCY_DIAGNOSTIC !== '1')(
  'checkout latency diagnostic',
  () => {
    interface Sample {
      phase: string
      concurrency: number
      request: string
      ms: number
      ok: boolean
      spans: Record<string, { count: number; ms: number }>
    }
    const context = new AsyncLocalStorage<Sample>()
    const active = new Map<string, Sample>()
    const samples: Sample[] = []
    const db = useDatabase()
    const pool = new Pool({ connectionString: db.url, max: 5, connectionTimeoutMillis: 5000 })
    const observable = new PrismaClient({ adapter: new PrismaPg(pool) })
    const api = useApiApp({ database: db, authenticate: true, prisma: observable })

    function instrument(target: object, key: string, label: string) {
      const original = Reflect.get(target, key) as (...args: unknown[]) => unknown
      if (typeof original !== 'function') throw new Error(`Missing instrument: ${label}`)
      Reflect.set(target, key, function (this: unknown, ...args: unknown[]) {
        const principal = args[0] as { userId?: string } | undefined
        const sample =
          context.getStore() ??
          (principal?.userId === undefined ? undefined : active.get(principal.userId))
        if (sample === undefined) return Reflect.apply(original, this, args)
        return context.run(sample, () => {
          const start = performance.now()
          let recorded = false
          const done = () => {
            if (recorded) return
            recorded = true
            const span = sample.spans[label] ?? { count: 0, ms: 0 }
            span.count += 1
            span.ms += performance.now() - start
            sample.spans[label] = span
          }
          const callback = args.at(-1)
          if (typeof callback === 'function' && label.startsWith('db.')) {
            args[args.length - 1] = function (this: unknown, ...values: unknown[]) {
              done()
              return Reflect.apply(callback as (...args: unknown[]) => unknown, this, values)
            }
          }
          try {
            const result = Reflect.apply(original, this, args)
            if (result instanceof Promise) return result.finally(done)
            if (typeof callback !== 'function') done()
            return result
          } catch (error) {
            done()
            throw error
          }
        })
      })
    }

    beforeAll(() => {
      instrument(pool, 'connect', 'db.acquire')
      // Also covers connections created during boot, before instrumentation is installed.
      const tracked = new WeakSet<object>()
      const trackClient = (client: object) => {
        if (!tracked.has(client)) {
          tracked.add(client)
          instrument(client, 'query', 'db.query')
        }
      }
      pool.on('connect', trackClient)
      pool.on('acquire', trackClient)
      instrument(observable, '$transaction', 'transaction')
      for (const [token, name, methods] of [
        [CartService, 'cart', ['add', 'get', 'account', 'linesOf']],
        [CheckoutService, 'checkout', ['open', 'read', 'account', 'linesOf']],
        [OrderService, 'order', ['create', 'account', 'markPaid']],
        [PaymentService, 'payment', ['start', 'authorize', 'capture', 'account', 'get']],
      ] as const) {
        const service = api.resolve<object>(token)
        for (const method of methods) instrument(service, method, `${name}.${method}`)
      }
      const provider = api
        .resolve<PaymentProviderRegistry>(PaymentProviderRegistry)
        .resolve('VIRTUAL_CARD')
      instrument(provider, 'authorize', 'provider.authorize')
      instrument(provider, 'capture', 'provider.capture')
    })
    afterAll(async () => {
      await observable.$disconnect()
      await pool.end()
    })

    it('records cold-first and 30 warm flows at concurrency 1 and 4', async () => {
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
        stock: 1000,
        isActive: true,
      })
      const buyers = await Promise.all(
        Array.from({ length: 4 }, async () => {
          const user = await createUser(db)
          const address = await createAddress(db, { userId: user.id, isDefault: true })
          const card = await api
            .resolve<VirtualCardService>(VirtualCardService)
            .issueFor(user.id, 1_000_000)
          return { userId: user.id, addressId: address.id, cardId: card.id }
        }),
      )
      async function flow(buyer: (typeof buyers)[number], phase: string, concurrency: number) {
        const client = api.clientAs({ userId: buyer.userId, roles: ['BUYER'] })
        async function measure<T>(request: string, work: () => Promise<T>): Promise<T> {
          const sample: Sample = { phase, concurrency, request, ms: 0, ok: false, spans: {} }
          active.set(buyer.userId, sample)
          const start = performance.now()
          try {
            const result = await work()
            sample.ok = true
            return result
          } finally {
            sample.ms = performance.now() - start
            active.delete(buyer.userId)
            samples.push(sample)
          }
        }
        const cart = await measure('cart.add', () =>
          client.request({
            path: '/cart/items',
            method: 'POST',
            body: { variantId: variant.id, quantity: 1 },
            schema: cartResponseSchema,
          }),
        )
        const { checkout } = await measure('checkout.open', () =>
          client.request({
            path: '/checkouts',
            method: 'POST',
            body: { itemIds: cart.groups.flatMap((g) => g.items.map((i) => i.id)) },
            schema: checkoutResponseSchema,
          }),
        )
        const { order } = await measure('order.create', () =>
          client.request({
            path: '/orders',
            method: 'POST',
            body: { checkoutId: checkout.id, addressId: buyer.addressId },
            schema: orderResponseSchema,
          }),
        )
        const { payment } = await measure('payment.start', () =>
          client.request({
            path: '/payments',
            method: 'POST',
            body: { orderId: order.id, provider: 'VIRTUAL_CARD', cardId: buyer.cardId },
            schema: paymentResponseSchema,
          }),
        )
        await measure('payment.authorize', () =>
          client.request({
            path: `/payments/${payment.id}/authorize`,
            method: 'POST',
            schema: paymentResponseSchema,
          }),
        )
        await measure('payment.capture', () =>
          client.request({
            path: `/payments/${payment.id}/capture`,
            method: 'POST',
            schema: paymentResponseSchema,
          }),
        )
        const cleared = await measure('cart.get', () =>
          client.request({ path: '/cart', schema: cartResponseSchema }),
        )
        expect(cleared.itemCount).toBe(0)
      }
      await flow(buyers[0]!, 'first-request-after-boot-and-fixtures', 1)
      for (let i = 0; i < 3; i += 1) await flow(buyers[0]!, 'warmup', 1)
      for (let i = 0; i < 30; i += 1) await flow(buyers[0]!, 'warm', 1)
      for (let i = 0; i < 8; i += 1)
        await Promise.all(buyers.map((buyer) => flow(buyer, 'warm', 4)))
      const output = process.env.CHECKOUT_LATENCY_OUTPUT ?? '/tmp/checkout-latency.json'
      await writeFile(
        output,
        JSON.stringify(
          {
            environment:
              'local PostgreSQL, pool 5, real HTTP, header principal resolver (JWT excluded), virtual card simulation off',
            samples,
          },
          null,
          2,
        ),
      )
      expect(samples.filter((s) => s.phase === 'warm').every((s) => s.ok)).toBe(true)
    }, 180_000)
  },
)
