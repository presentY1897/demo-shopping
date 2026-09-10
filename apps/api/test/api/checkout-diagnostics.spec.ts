import { beforeEach, describe, expect, it } from 'vitest'
import {
  cartResponseSchema,
  checkoutResponseSchema,
  orderResponseSchema,
  paymentResponseSchema,
} from '@shopping/shared'
import { VirtualCardService } from '../../src/payment/virtual-card.service.js'
import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'
import { callerHeaders } from '../support/principal.js'
import {
  createUser,
  createAddress,
  createCategory,
  createSeller,
  createProduct,
  createProductVariant,
} from '../support/factories.js'

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })
let headers: Record<string, string>
let addressId: string
let cardId: string
let variantId: string

beforeEach(async () => {
  const user = await createUser(db)
  headers = {
    ...callerHeaders({ userId: user.id, roles: ['BUYER'] }),
    'X-Checkout-Diagnostics': '1',
    'Content-Type': 'application/json',
  }
  addressId = (await createAddress(db, { userId: user.id, isDefault: true })).id
  cardId = (await api.resolve<VirtualCardService>(VirtualCardService).issueFor(user.id, 1_000_000))
    .id
  const seller = await createSeller(db, { userId: (await createUser(db)).id })
  const category = await createCategory(db)
  const product = await createProduct(db, {
    sellerId: seller.id,
    categoryId: category.id,
    status: 'ACTIVE',
    minPrice: 1000,
  })
  variantId = (
    await createProductVariant(db, {
      sellerId: seller.id,
      productId: product.id,
      price: 1000,
      stock: 10,
      isActive: true,
    })
  ).id
})

function spans(response: Response): Map<string, { ms: number; count: number }> {
  const header = response.headers.get('server-timing')
  expect(header).not.toBeNull()
  const result = new Map<string, { ms: number; count: number }>()
  for (const value of (header ?? '').split(', ')) {
    const match = /^([a-zA-Z_]+);dur=(\d+\.\d{2})(?:;desc="(\d+)")?$/.exec(value)
    expect(match).not.toBeNull()
    if (match !== null)
      result.set(match[1]!, { ms: Number(match[2]), count: Number(match[3] ?? 1) })
  }
  return result
}

async function post(path: string, body: unknown): Promise<Response> {
  const response = await fetch(`${api.baseUrl}/api/v1${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  expect(response.ok, await response.clone().text()).toBe(true)
  const measured = spans(response)
  expect(measured.get('db_query')?.count).toBeGreaterThan(0)
  expect(measured.get('db_acquire')?.count).toBeGreaterThan(0)
  expect(measured.get('auth')?.count).toBe(1)
  expect(measured.get('total')?.ms).toBeGreaterThan(0)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('x-request-id')).toBeTruthy()
  return response
}

describe('selective checkout diagnostics against PostgreSQL', () => {
  it('measures real purchase, provider and paid cart cleanup without changing contracts', async () => {
    const cart = cartResponseSchema.parse(
      await (await post('/cart/items', { variantId, quantity: 1 })).json(),
    )
    const { checkout } = checkoutResponseSchema.parse(
      await (
        await post('/checkouts', { itemIds: cart.groups.flatMap((g) => g.items.map((i) => i.id)) })
      ).json(),
    )
    const { order } = orderResponseSchema.parse(
      await (await post('/orders', { checkoutId: checkout.id, addressId })).json(),
    )
    const { payment } = paymentResponseSchema.parse(
      await (
        await post('/payments', { orderId: order.id, provider: 'VIRTUAL_CARD', cardId })
      ).json(),
    )
    const authorized = await post(`/payments/${payment.id}/authorize`, {})
    expect(spans(authorized).get('provider_authorize')?.count).toBe(1)
    const captured = await post(`/payments/${payment.id}/capture`, {})
    expect(spans(captured).get('provider_capture')?.count).toBe(1)
    expect(spans(captured).get('transaction')?.count).toBeGreaterThan(0)
    const paid = paymentResponseSchema.parse(await captured.json())
    expect(paid.payment.status).toBe('PAID')
    const response = await fetch(`${api.baseUrl}/api/v1/cart`, { headers })
    expect(cartResponseSchema.parse(await response.json()).itemCount).toBe(0)
    expect(spans(response).get('cart_get')?.count).toBe(1)
  })

  it('does not mix simultaneous requests or retain previous spans', async () => {
    const read = () => fetch(`${api.baseUrl}/api/v1/cart`, { headers })
    const baseline = spans(await read()).get('db_query')?.count
    const results = await Promise.all([read(), read()])
    for (const response of results) {
      const measured = spans(response)
      expect(measured.get('db_query')?.count).toBe(baseline)
      expect(measured.get('cart_get')?.count).toBe(1)
      expect(measured.has('provider_authorize')).toBe(false)
    }
  })

  it('does not expose measurements on ordinary, anonymous or unrelated requests', async () => {
    for (const [path, requestHeaders] of [
      ['/cart', { ...headers, 'X-Checkout-Diagnostics': '0' }],
      ['/cart', { 'X-Checkout-Diagnostics': '1' }],
      ['/health', headers],
    ] as const) {
      const response = await fetch(`${api.baseUrl}/api/v1${path}`, { headers: requestHeaders })
      expect(response.headers.get('server-timing')).toBeNull()
    }
  })
})
