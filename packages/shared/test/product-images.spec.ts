import { describe, expect, it } from 'vitest'

import { createProductRequestSchema, updateProductRequestSchema } from '../src/api/products.js'

const images = Array.from({ length: 12 }, (_, index) => ({
  url: `/images/shot-${String(index)}.png`,
}))

describe('product image coverage', () => {
  it('accepts the full shared product and two-model gallery on create and update', () => {
    expect(
      createProductRequestSchema.safeParse({
        categoryId: 1,
        name: 'Unisex tee',
        variantDefaults: { price: 29000, stock: 20 },
        images,
      }).success,
    ).toBe(true)
    expect(updateProductRequestSchema.safeParse({ version: 1, images }).success).toBe(true)
  })

  it('rejects images beyond the twelve-image gallery on both write paths', () => {
    const overflow = [...images, { url: '/extra.png' }]
    expect(
      createProductRequestSchema.safeParse({
        categoryId: 1,
        name: 'Unisex tee',
        variantDefaults: { price: 29000, stock: 20 },
        images: overflow,
      }).success,
    ).toBe(false)
    expect(updateProductRequestSchema.safeParse({ version: 1, images: overflow }).success).toBe(
      false,
    )
  })
})
