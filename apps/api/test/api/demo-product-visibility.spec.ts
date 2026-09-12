import type { ApiClientError } from '@shopping/shared'
import { cartResponseSchema, productListResponseSchema } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

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

describe('demo administrator hidden catalogue ownership', () => {
  it('finds hidden products in its demo scope without exposing real hidden products to demo admins or buyers', async () => {
    const category = await createCategory(db)
    const rows = []
    for (const isDemo of [false, true]) {
      const owner = await createUser(db, {
        isDemo,
        demoExpiresAt: isDemo ? new Date(api.clock.now().getTime() + 86_400_000) : null,
      })
      const seller = await createSeller(db, { userId: owner.id, status: 'ACTIVE' })
      const product = await createProduct(db, {
        sellerId: seller.id,
        categoryId: category.id,
        name: '숨김 검색 회귀',
        status: 'SUSPENDED',
      })
      rows.push(product)
    }
    const [real, demo] = rows
    const variant = await createProductVariant(db, {
      productId: demo!.id,
      sellerId: demo!.sellerId,
      price: 10000,
      stock: 5,
      isActive: true,
    })
    const adminUser = await createUser(db, {
      isDemo: true,
      demoExpiresAt: new Date(api.clock.now().getTime() + 86_400_000),
    })
    const admin = api.clientAs({ userId: adminUser.id, roles: ['DEMO_ADMIN'] })
    const buyerUser = await createUser(db)
    const buyer = api.clientAs({ userId: buyerUser.id, roles: ['BUYER'] })
    const page = await admin.request({
      path: `/products?q=${encodeURIComponent('숨김 검색 회귀')}`,
      schema: productListResponseSchema,
    })
    expect(page.products.map((product) => product.id)).toEqual([demo!.id])
    expect((await admin.getProduct(demo!.id)).product.id).toBe(demo!.id)
    for (const [client, id] of [
      [admin, real!.id],
      [buyer, demo!.id],
      [buyer, real!.id],
    ] as const) {
      await expect(client.getProduct(id)).rejects.toMatchObject({
        status: 404,
      } satisfies Partial<ApiClientError>)
    }
    await expect(
      buyer.request({
        path: '/cart/items',
        method: 'POST',
        body: { variantId: variant.id, quantity: 1 },
        schema: cartResponseSchema,
      }),
    ).rejects.toMatchObject({ status: 400, body: { error: { code: 'CART_ITEM_UNAVAILABLE' } } })
    expect(
      (await buyer.request({ path: '/products', schema: productListResponseSchema })).products,
    ).toHaveLength(0)
  })
})
