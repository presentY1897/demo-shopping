/**
 * What the product double promises the editor that builds on it (TASK-0114).
 *
 * **This file exists because of TASK-0112.** That task found a band answering
 * differently from the server — a `DELETE` whose `isDefault` was wrong — and
 * the symptom was a front-end suite that stayed green while the real screen
 * broke. So the band's own behaviour is pinned here, against the service in
 * `apps/api/src/catalog/product.service.ts`, before any screen leans on it.
 *
 * Every call goes through `createApiClient`, the client the app itself uses, so
 * a response that drifted from the shared schema fails here as
 * `malformed_response` rather than reaching a screen that renders it (C1·C2).
 */

import type { ApiFieldError, CategoryTreeNode, CreateProductRequest } from '@shopping/shared'
import {
  createApiClient,
  isApiClientError,
  isApiFieldError,
  PRODUCT_MAX_VARIANTS,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { categoryTree } from './fixtures/categories'
import { productDraft, productWithOptions } from './fixtures/products'
import { productRowsSnapshot, resetProductStore } from './handlers'
import { setupTestServer } from './node'

setupTestServer()

const client = createApiClient({ appId: 'seller', baseUrl: 'http://api.test.invalid' })

function flatten(nodes: readonly CategoryTreeNode[]): CategoryTreeNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}

function categoryId(slug: string): number {
  const node = flatten(categoryTree.nodes).find((candidate) => candidate.slug === slug)

  if (node === undefined) throw new Error(`no category ${slug}`)

  return node.id
}

/** 코트 — six effective definitions, `brand` and `fit` required. */
const COAT = categoryId('women-outer-coat')

/** 가방 — no definitions at all, so nothing is ever required. */
const BAGS = categoryId('bags')

const SELLER_ID = productWithOptions.product.sellerId

/** The envelope of a refused call, or `null` when it succeeded. */
async function refusalOf(
  call: Promise<unknown>,
): Promise<{ status: number; code: string; details: readonly unknown[] } | null> {
  return call.then(
    () => null,
    (error: unknown) => {
      if (!isApiClientError(error) || error.body === undefined) return null

      return {
        status: error.status ?? -1,
        code: error.body.error.code,
        details: error.body.error.details,
      }
    },
  )
}

function fieldErrors(details: readonly unknown[]): readonly ApiFieldError[] {
  return details.filter((entry): entry is ApiFieldError => isApiFieldError(entry))
}

function axis(name: string, ...values: readonly string[]) {
  return { name, values: values.map((value) => ({ value })) }
}

const COMPLETE_ATTRIBUTES = { brand: '루미에르', fit: '오버핏' } as const

function creation(overrides: Partial<CreateProductRequest> = {}): CreateProductRequest {
  return {
    categoryId: COAT,
    name: '테스트 코트',
    attributes: { ...COMPLETE_ATTRIBUTES },
    variantDefaults: { price: 10_000, stock: 3 },
    ...overrides,
  }
}

beforeEach(() => {
  resetProductStore()
})

describe('loading a listing', () => {
  it('answers the seeded product with its axes and every combination', async () => {
    const { product } = await client.getProduct(productWithOptions.product.id)

    expect(product.options.map((option) => option.name)).toEqual(['색상', '사이즈'])
    expect(product.variants).toHaveLength(12)
    // The mapping, not just the count: without it a buyer's selection cannot be
    // traced back to a variant, and a count alone hides that gap.
    expect(product.variants.every((variant) => variant.optionValueIds.length === 2)).toBe(true)
  })

  it('answers the draft with one variant, because an optionless product still has one', async () => {
    const { product } = await client.getProduct(productDraft.product.id)

    expect(product.options).toEqual([])
    expect(product.variants).toHaveLength(1)
    expect(product.variants[0]?.optionValueIds).toEqual([])
  })

  it('answers 404 for a listing that is not there', async () => {
    const refusal = await refusalOf(client.getProduct('019596d0-1f1c-7c2e-9a0e-000000000000'))

    expect(refusal?.status).toBe(404)
  })
})

describe('creating a listing', () => {
  it('expands the axes into one variant per combination', async () => {
    const { product } = await client.createProduct(
      creation({
        options: [axis('색상', '블랙', '아이보리', '카멜'), axis('사이즈', 'S', 'M', 'L', 'XL')],
      }),
    )

    expect(product.variants).toHaveLength(12)
    // First axis varying slowest, the order `expandCombinations` produces.
    expect(product.variants.slice(0, 4).map((variant) => variant.sku.split('-').pop())).toEqual([
      '1',
      '2',
      '3',
      '4',
    ])
  })

  it('gives an optionless product exactly one variant', async () => {
    const { product } = await client.createProduct(creation())

    expect(product.variants).toHaveLength(1)
    expect(product.variants[0]?.optionValueIds).toEqual([])
  })

  it('starts as a draft when no status is asked for', async () => {
    const { product } = await client.createProduct(creation())

    expect(product.status).toBe('DRAFT')
  })

  it('lets a draft leave a required attribute empty', async () => {
    const { product } = await client.createProduct(creation({ attributes: {} }))

    expect(product.status).toBe('DRAFT')
    expect(product.attributes).toEqual({})
  })

  it('refuses to publish with a required attribute empty, naming every one of them', async () => {
    const refusal = await refusalOf(
      client.createProduct(creation({ status: 'ACTIVE', attributes: {} })),
    )

    expect(refusal?.status).toBe(400)
    expect(refusal?.code).toBe('PRODUCT_ATTRIBUTES_REQUIRED')
    // Both at once. One at a time would make the seller press 판매 시작 twice.
    expect(fieldErrors(refusal?.details ?? []).map((entry) => entry.field)).toEqual([
      'attributes.brand',
      'attributes.fit',
    ])
  })

  it('refuses a key no definition of the category explains, even in a draft', async () => {
    const refusal = await refusalOf(
      client.createProduct(creation({ attributes: { colourway: 'x' } })),
    )

    expect(refusal?.status).toBe(400)
    expect(fieldErrors(refusal?.details ?? [])[0]?.field).toBe('attributes.colourway')
  })

  it('requires nothing in a category that defines nothing', async () => {
    const { product } = await client.createProduct(
      creation({ categoryId: BAGS, status: 'ACTIVE', attributes: {} }),
    )

    expect(product.status).toBe('ACTIVE')
  })

  it('refuses more combinations than a listing may hold, and says how many', async () => {
    const values = Array.from({ length: 21 }, (_unused, index) => `V${String(index)}`)
    const refusal = await refusalOf(
      client.createProduct(
        creation({
          options: [
            axis('색상', ...values),
            axis('사이즈', ...Array.from({ length: 10 }, (_u, i) => `S${String(i)}`)),
          ],
        }),
      ),
    )

    expect(refusal?.status).toBe(400)
    expect(refusal?.code).toBe('PRODUCT_TOO_MANY_VARIANTS')
    expect(fieldErrors(refusal?.details ?? [])[0]?.params).toEqual({ max: PRODUCT_MAX_VARIANTS })
  })

  it('accepts exactly the cap', async () => {
    const { product } = await client.createProduct(
      creation({
        options: [
          axis('색상', ...Array.from({ length: 20 }, (_u, i) => `C${String(i)}`)),
          axis('사이즈', ...Array.from({ length: 10 }, (_u, i) => `S${String(i)}`)),
        ],
      }),
    )

    // The boundary measured from both sides: a band that read the constant one
    // off would pass a test that only pushed past it.
    expect(product.variants).toHaveLength(PRODUCT_MAX_VARIANTS)
  })

  it('applies the bulk defaults to every combination, purchase cap included', async () => {
    const { product } = await client.createProduct(
      creation({
        options: [axis('사이즈', 'S', 'M', 'L')],
        variantDefaults: { price: 12_000, stock: 7, maxPurchaseQuantity: 2 },
      }),
    )

    expect(product.variants.map((variant) => variant.price)).toEqual([12_000, 12_000, 12_000])
    expect(product.variants.map((variant) => variant.stock)).toEqual([7, 7, 7])
    expect(product.variants.map((variant) => variant.maxPurchaseQuantity)).toEqual([2, 2, 2])
    expect(product.variants.map((variant) => variant.effectiveMaxPurchaseQuantity)).toEqual([
      2, 2, 2,
    ])
  })

  it('lets one combination override the defaults', async () => {
    const { product } = await client.createProduct(
      creation({
        options: [axis('사이즈', 'S', 'M')],
        variants: [{ optionValues: ['M'], price: 19_000, isActive: false }],
      }),
    )

    expect(product.variants.map((variant) => variant.price)).toEqual([10_000, 19_000])
    expect(product.variants.map((variant) => variant.isActive)).toEqual([true, false])
    // Derived from the orderable ones only.
    expect(product.minPrice).toBe(10_000)
  })

  it('refuses a combination the axes do not produce', async () => {
    const refusal = await refusalOf(
      client.createProduct(
        creation({ options: [axis('사이즈', 'S')], variants: [{ optionValues: ['XXL'] }] }),
      ),
    )

    expect(fieldErrors(refusal?.details ?? [])[0]?.field).toBe('variants.0.optionValues')
  })

  it('refuses two rows of one request holding the same SKU', async () => {
    const refusal = await refusalOf(
      client.createProduct(
        creation({
          options: [axis('사이즈', 'S', 'M')],
          variants: [
            { optionValues: ['S'], sku: 'SAME' },
            { optionValues: ['M'], sku: 'SAME' },
          ],
        }),
      ),
    )

    expect(refusal?.status).toBe(409)
    expect(refusal?.code).toBe('PRODUCT_SKU_TAKEN')
  })

  it('refuses a gallery pointing into another store, naming the position', async () => {
    const refusal = await refusalOf(
      client.createProduct(
        creation({
          images: [
            { url: 'https://images.unsplash.com/photo-anything' },
            {
              url: `https://cdn.test.invalid/products/019596d0-1f1c-7c2e-9a0e-4a5a3a2f9999/019596d0-1f1c-7c2e-9a0e-4a5a3a2f8888.jpg`,
            },
          ],
        }),
      ),
    )

    expect(fieldErrors(refusal?.details ?? [])[0]?.field).toBe('images.1.url')
  })

  it('lets stock photography through, because no sweep will ever consider it', async () => {
    const { product } = await client.createProduct(
      creation({ images: [{ url: 'https://images.unsplash.com/photo-anything', alt: '정면' }] }),
    )

    expect(product.images.map((image) => image.sortOrder)).toEqual([0])
  })

  it('accepts our own key when it is this store"s', async () => {
    const url = `https://cdn.test.invalid/products/${SELLER_ID}/019596d0-1f1c-7c2e-9a0e-4a5a3a2f8888.jpg`
    const { product } = await client.createProduct(creation({ images: [{ url }] }))

    expect(product.images[0]?.url).toBe(url)
  })
})

describe('editing a listing', () => {
  const stored = productWithOptions.product

  it('creates only the combinations a new choice brought into existence', async () => {
    const before = await client.getProduct(stored.id)
    const stocks = new Map(before.product.variants.map((v) => [v.id, v.stock] as const))

    const { product } = await client.updateProduct(stored.id, {
      version: before.product.version,
      options: [
        axis('색상', '블랙', '아이보리', '카멜'),
        axis('사이즈', 'S', 'M', 'L', 'XL', 'XXL'),
      ],
      variantDefaults: { price: 189_000, stock: 0 },
    })

    expect(product.variants).toHaveLength(15)
    // The twelve that were already there keep their stock, id by id. A build
    // that recreated everything is indistinguishable by count and only here.
    for (const [id, stock] of stocks) {
      expect(product.variants.find((variant) => variant.id === id)?.stock).toBe(stock)
    }
  })

  it('switches off the combinations a removed choice orphaned, and deletes no row', async () => {
    const before = await client.getProduct(stored.id)

    const { product } = await client.updateProduct(stored.id, {
      version: before.product.version,
      options: [axis('색상', '블랙'), axis('사이즈', 'S', 'M', 'L', 'XL')],
    })

    // Twelve rows still there — an order placed yesterday points at one of them.
    expect(product.variants).toHaveLength(12)
    expect(product.variants.filter((variant) => variant.isActive)).toHaveLength(4)
  })

  it('refuses a change to the axes themselves', async () => {
    const before = await client.getProduct(stored.id)
    const refusal = await refusalOf(
      client.updateProduct(stored.id, {
        version: before.product.version,
        options: [axis('색상', '블랙')],
      }),
    )

    expect(refusal?.status).toBe(400)
    expect(fieldErrors(refusal?.details ?? [])[0]?.field).toBe('options')
  })

  it('refuses a stale version and says which field lost', async () => {
    const refusal = await refusalOf(
      client.updateProduct(stored.id, { version: 0, name: '새 이름' }),
    )

    expect(refusal?.status).toBe(409)
    expect(refusal?.code).toBe('PRODUCT_VERSION_CONFLICT')
    expect(fieldErrors(refusal?.details ?? [])[0]?.field).toBe('version')
  })

  it('bumps the version on every accepted save', async () => {
    const before = await client.getProduct(stored.id)
    const { product } = await client.updateProduct(stored.id, {
      version: before.product.version,
      name: '새 이름',
    })

    expect(product.version).toBe(before.product.version + 1)
  })

  it('re-derives the lowest price from the live variants', async () => {
    const before = await client.getProduct(stored.id)
    const { product } = await client.updateProduct(stored.id, {
      version: before.product.version,
      variants: [{ optionValues: ['블랙', 'S'], price: 99_000 }],
    })

    expect(product.minPrice).toBe(99_000)
  })
})

describe('publishing', () => {
  it('takes a complete draft on sale and back off again', async () => {
    const { product: created } = await client.createProduct(creation())
    const { product: live } = await client.publishProduct(created.id, { version: created.version })

    expect(live.status).toBe('ACTIVE')

    const { product: back } = await client.unpublishProduct(live.id, { version: live.version })

    // `DRAFT`, not `INACTIVE`: 발행 취소 is the seller reopening the editor.
    expect(back.status).toBe('DRAFT')
  })

  it('refuses an incomplete draft, and the draft survives', async () => {
    const { product: created } = await client.createProduct(creation({ attributes: {} }))
    const refusal = await refusalOf(client.publishProduct(created.id, { version: created.version }))

    expect(refusal?.code).toBe('PRODUCT_ATTRIBUTES_REQUIRED')
    expect(productRowsSnapshot().find((row) => row.id === created.id)?.status).toBe('DRAFT')
  })

  it('refuses a listing with nothing orderable behind it', async () => {
    const { product: created } = await client.createProduct(
      creation({
        options: [axis('사이즈', 'S')],
        variants: [{ optionValues: ['S'], isActive: false }],
      }),
    )
    const refusal = await refusalOf(client.publishProduct(created.id, { version: created.version }))

    expect(refusal?.status).toBe(400)
    expect(refusal?.code).toBe('PRODUCT_NOT_SELLABLE')
    expect(fieldErrors(refusal?.details ?? [])[0]?.field).toBe('status')
  })

  it('refuses a stale version', async () => {
    const refusal = await refusalOf(client.publishProduct(productDraft.product.id, { version: 99 }))

    expect(refusal?.code).toBe('PRODUCT_VERSION_CONFLICT')
  })
})

describe('the store', () => {
  it('goes back to the fixtures between tests', () => {
    expect(productRowsSnapshot()).toHaveLength(2)
  })

  it('hands out copies, so a caller cannot edit the catalogue through one', async () => {
    const { product } = await client.getProduct(productDraft.product.id)
    const mutable = product as { name: string }

    mutable.name = '바뀐 이름'

    const again = await client.getProduct(productDraft.product.id)

    expect(again.product.name).toBe(productDraft.product.name)
  })
})
