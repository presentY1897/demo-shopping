/**
 * What the words have to satisfy before 800 rows are written with them.
 *
 * Two of these are the completion criteria themselves — F6 (실제 상표 0건) is
 * partly a review and partly the check below that the brand list is fifteen
 * *distinct* coinages, and R2 (이름과 이미지가 어긋남) is the check that a leaf
 * category can only be named with its own 품목.
 */

import { productNameSchema, productDescriptionSchema, sellerSlugSchema } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { seededRandom } from './random.js'
import { leafCategories } from './taxonomy.js'
import {
  namedLeafSlugs,
  productDescription,
  productName,
  SEED_BRANDS,
  storeIntroduction,
} from './vocabulary.js'

describe('the fifteen stores', () => {
  it('is fifteen of them', () => {
    expect(SEED_BRANDS).toHaveLength(15)
  })

  it('has no two the same, by name or by slug', () => {
    // A duplicate is not a cosmetic problem: `Seller.brandName` and
    // `Seller.slug` are both unique, so the seed would die on the second one.
    expect(new Set(SEED_BRANDS.map(([name]) => name)).size).toBe(15)
    expect(new Set(SEED_BRANDS.map(([, slug]) => slug)).size).toBe(15)
  })

  it('gives every store a slug the API accepts', () => {
    for (const [, slug] of SEED_BRANDS) {
      expect(sellerSlugSchema.safeParse(slug).success, slug).toBe(true)
    }
  })
})

describe('product names', () => {
  it('can name every leaf the taxonomy has', () => {
    // The failure this prevents: adding a leaf to `taxonomy.ts` and finding out
    // at row 400 of the seed that it has no 품목 vocabulary.
    const named = new Set(namedLeafSlugs())

    for (const leaf of leafCategories()) {
      expect(named, leaf.slug).toContain(leaf.slug)
    }
  })

  it('refuses a category it has no words for, rather than inventing one', () => {
    expect(() => productName(seededRandom('name'), 'women-tops-nonexistent')).toThrow('품목 어휘')
  })

  it('names a skirt a skirt (R2)', () => {
    const random = seededRandom('skirt')

    for (let index = 0; index < 30; index += 1) {
      expect(productName(random, 'women-bottoms-skirts')).toMatch(/스커트$/)
    }
  })

  it('produces something the API accepts, every time', () => {
    const random = seededRandom('names')

    for (const leaf of leafCategories()) {
      for (let index = 0; index < 20; index += 1) {
        const name = productName(random, leaf.slug)

        expect(productNameSchema.safeParse(name).success, name).toBe(true)
      }
    }
  })

  it('does not give every row the same rhythm', () => {
    // 800 listings that are all `[계절] [수식어] [품목]` read as generated at a
    // glance, which is the impression this data exists to avoid.
    const random = seededRandom('rhythm')
    const widths = new Set(
      Array.from({ length: 60 }, () => productName(random, 'women-tops-knits').split(' ').length),
    )

    expect(widths.size).toBeGreaterThan(1)
  })
})

describe('descriptions and introductions', () => {
  it('produces a description the API accepts', () => {
    const random = seededRandom('desc')

    for (let index = 0; index < 50; index += 1) {
      const text = productDescription(random, '데일리 반팔 티셔츠')

      expect(productDescriptionSchema.safeParse(text).success).toBe(true)
      expect(text).toContain('데일리 반팔 티셔츠')
    }
  })

  it('does not hand 800 listings one paragraph', () => {
    const random = seededRandom('desc')
    const texts = new Set(Array.from({ length: 40 }, () => productDescription(random, '같은 이름')))

    expect(texts.size).toBeGreaterThan(5)
  })

  it('varies what a store says about itself', () => {
    const random = seededRandom('intro')
    const texts = new Set(Array.from({ length: 15 }, () => storeIntroduction(random)))

    expect(texts.size).toBeGreaterThan(1)
  })
})
