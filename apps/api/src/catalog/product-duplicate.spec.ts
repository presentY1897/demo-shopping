import type { Product, ProductOption, ProductVariant } from '@shopping/shared'
import { createProductRequestSchema, PRODUCT_NAME_MAX_LENGTH } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { DUPLICATE_NAME_SUFFIX, duplicateName, duplicateRequest } from './product-duplicate.js'

/** Ids only have to be distinguishable; nothing here looks one up. */
function id(seed: string): string {
  return `0192f0c1-0000-7000-8000-${seed.padStart(12, '0')}`
}

function option(name: string, values: readonly string[], from: number): ProductOption {
  return {
    id: id(`a${String(from)}`),
    name,
    sortOrder: 0,
    values: values.map((value, index) => ({
      id: id(`b${String(from + index)}`),
      value,
      meta: null,
      sortOrder: index,
    })),
  }
}

function variant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: id('c1'),
    sku: 'TSHIRT-1',
    price: 19_000,
    listPrice: null,
    stock: 12,
    maxPurchaseQuantity: null,
    effectiveMaxPurchaseQuantity: null,
    isActive: true,
    optionValueIds: [],
    ...overrides,
  }
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: id('d1'),
    sellerId: id('e1'),
    categoryId: 3,
    name: '오버사이즈 티셔츠',
    description: null,
    status: 'ACTIVE',
    attributes: {},
    maxPurchaseQuantity: null,
    minPrice: 19_000,
    ratingAvg: 0,
    ratingCount: 0,
    salesCount: 0,
    version: 4,
    images: [],
    options: [],
    variants: [variant()],
    ...overrides,
  }
}

/** 색상 2 × 사이즈 2, with the four combinations spelled out. */
function grid(): Product {
  const colour = option('색상', ['블랙', '화이트'], 10)
  const size = option('사이즈', ['S', 'M'], 20)

  return product({
    options: [colour, size],
    variants: colour.values.flatMap((chosen, left) =>
      size.values.map((measure, right) =>
        variant({
          id: id(`c${String(left * 2 + right + 1)}`),
          sku: `TSHIRT-${String(left * 2 + right + 1)}`,
          price: 19_000 + left * 1_000,
          // Deliberately reversed: the stored order is a join's order, not the
          // axis order, and the copy has to put it back.
          optionValueIds: [measure.id, chosen.id],
        }),
      ),
    ),
  })
}

describe('duplicateName', () => {
  it('marks the copy', () => {
    expect(duplicateName('오버사이즈 티셔츠')).toBe(`오버사이즈 티셔츠${DUPLICATE_NAME_SUFFIX}`)
  })

  it('keeps a maximum-length name inside the limit', () => {
    const copied = duplicateName('가'.repeat(PRODUCT_NAME_MAX_LENGTH))

    // Without the trim the copy's own request is a 400 the caller cannot act on.
    expect(copied).toHaveLength(PRODUCT_NAME_MAX_LENGTH)
    expect(copied.endsWith(DUPLICATE_NAME_SUFFIX)).toBe(true)
  })

  it('does not leave a dangling space where it cut', () => {
    const copied = duplicateName(`${'가'.repeat(PRODUCT_NAME_MAX_LENGTH - 7)} 나나나나나`)

    expect(copied).not.toContain('  ')
    expect(copied.length).toBeLessThanOrEqual(PRODUCT_NAME_MAX_LENGTH)
  })
})

describe('duplicateRequest', () => {
  it('produces a request the create schema accepts', () => {
    expect(() => createProductRequestSchema.parse(duplicateRequest(grid()))).not.toThrow()
  })

  it('starts every combination at zero stock', () => {
    const request = duplicateRequest(grid())

    // The invariant this whole design protects: stock that appeared without a
    // movement is stock the ledger cannot explain.
    expect(request.variantDefaults.stock).toBe(0)
    expect(request.variants?.every((entry) => !('stock' in entry))).toBe(true)
  })

  it('asks for no status, so the copy is a draft', () => {
    expect(duplicateRequest(grid()).status).toBeUndefined()
  })

  it('names no SKU, so the generator issues fresh ones', () => {
    const request = duplicateRequest(grid())

    expect(request.skuPrefix).toBeUndefined()
    expect(request.variants?.every((entry) => entry.sku === undefined)).toBe(true)
  })

  it('names every combination in axis order', () => {
    const request = duplicateRequest(grid())

    expect(request.variants?.map((entry) => entry.optionValues)).toEqual([
      ['블랙', 'S'],
      ['블랙', 'M'],
      ['화이트', 'S'],
      ['화이트', 'M'],
    ])
  })

  it('carries the price of each combination', () => {
    expect(duplicateRequest(grid()).variants?.map((entry) => entry.price)).toEqual([
      19_000, 19_000, 20_000, 20_000,
    ])
  })

  it('keeps a switched-off combination switched off', () => {
    const source = grid()
    const [first, ...rest] = source.variants
    const copied = duplicateRequest(
      product({
        ...source,
        variants: [{ ...(first as ProductVariant), isActive: false }, ...rest],
      }),
    )

    expect(copied.variants?.map((entry) => entry.isActive)).toEqual([false, true, true, true])
  })

  it('leaves out a combination built from a retired choice', () => {
    const source = grid()
    const retired = variant({ id: id('c9'), optionValueIds: [id('bff'), id('b10')] })
    const copied = duplicateRequest(product({ ...source, variants: [...source.variants, retired] }))

    // Its choice is gone from the axes, so the copy's grid never produces the
    // combination and naming it would be refused as `unknown_combination`.
    expect(copied.variants).toHaveLength(4)
  })

  it('copies the gallery, with and without alt text', () => {
    const copied = duplicateRequest(
      product({
        images: [
          { id: id('f1'), url: 'https://images.test/1.jpg', alt: '앞면', sortOrder: 0 },
          { id: id('f2'), url: 'https://images.test/2.jpg', alt: null, sortOrder: 1 },
        ],
      }),
    )

    expect(copied.images).toEqual([
      { url: 'https://images.test/1.jpg', alt: '앞면' },
      { url: 'https://images.test/2.jpg' },
    ])
  })

  it('copies the description, the cap and the attribute values', () => {
    const copied = duplicateRequest(
      product({ description: '두껍다', maxPurchaseQuantity: 3, attributes: { material: '면' } }),
    )

    expect(copied).toMatchObject({
      description: '두껍다',
      maxPurchaseQuantity: 3,
      attributes: { material: '면' },
    })
  })

  it('omits the ones that were not set rather than sending null', () => {
    const copied = duplicateRequest(product())

    expect('description' in copied).toBe(false)
    expect('maxPurchaseQuantity' in copied).toBe(false)
  })

  it('copies a choice’s presentation extras', () => {
    const colour = option('색상', ['블랙'], 30)
    const copied = duplicateRequest(
      product({
        options: [{ ...colour, values: [{ ...colour.values[0]!, meta: { hex: '#000' } }] }],
        variants: [variant({ optionValueIds: [colour.values[0]!.id] })],
      }),
    )

    expect(copied.options?.[0]?.values).toEqual([{ value: '블랙', meta: { hex: '#000' } }])
  })

  it('sends no options for a listing that has none', () => {
    const copied = duplicateRequest(product())

    expect(copied.options).toBeUndefined()
    expect(copied.variants).toEqual([
      {
        optionValues: [],
        price: 19_000,
        listPrice: null,
        maxPurchaseQuantity: null,
        isActive: true,
      },
    ])
  })

  it('starts from the cheapest variant, even when none is orderable', () => {
    const copied = duplicateRequest(
      product({
        minPrice: null,
        variants: [
          variant({ id: id('c1'), price: 30_000, isActive: false }),
          variant({ id: id('c2'), price: 12_000, isActive: false }),
        ],
      }),
    )

    // `minPrice` is null here — it only covers orderable rows — and
    // `variantDefaults.price` may not be.
    expect(copied.variantDefaults.price).toBe(12_000)
  })

  it('falls back to zero when there is nothing left to copy', () => {
    expect(duplicateRequest(product({ variants: [] })).variantDefaults.price).toBe(0)
  })
})
