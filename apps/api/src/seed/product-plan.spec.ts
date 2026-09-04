/**
 * 800 listings, checked against the schemas the controller parses with —
 * without a database.
 *
 * The failure this file prevents is the expensive one: `pnpm db:seed` writing
 * 400 products and then dying on the 401st because one leaf category produced a
 * request the API refuses. Everything below is a rule `ProductService` enforces,
 * asserted here at the point where it is cheap to fix.
 */

import { createProductRequestSchema, PRODUCT_MAX_VARIANTS, skuPrefixSchema } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  attributesFor,
  planCatalogue,
  planProduct,
  SEED_SCALES,
  seedSkuPrefix,
} from './product-plan.js'
import { seededRandom } from './random.js'
import { effectiveAttributes, leafCategories } from './taxonomy.js'

const COLOURS = ['블랙', '화이트', '아이보리', '그레이', '네이비', '베이지'] as const

/** The whole catalogue, planned — 32 listings per leaf is a little over 800. */
function catalogue() {
  const random = seededRandom('상품')

  return leafCategories().flatMap((leaf, leafIndex) =>
    Array.from({ length: 32 }, (_unused, index) =>
      planProduct(random, {
        leafSlug: leaf.slug,
        sellerIndex: (leafIndex + index) % 15,
        colourOptions: COLOURS,
        showcase: false,
      }),
    ),
  )
}

const planned = catalogue()

describe('the request the API will receive', () => {
  it('is accepted by the schema, every time', () => {
    for (const item of planned) {
      const parsed = createProductRequestSchema.safeParse({ ...item.request, categoryId: 1 })

      expect(parsed.success, `${item.leafSlug}: ${item.request.name}`).toBe(true)
    }
  })

  it('never asks for more combinations than a listing may have', () => {
    for (const item of planned) {
      expect((item.request.variants ?? []).length).toBeLessThanOrEqual(PRODUCT_MAX_VARIANTS)
    }
  })

  it('gives every combination the axes it declared, in order', () => {
    for (const item of planned) {
      const axes = (item.request.options ?? []).length

      for (const variant of item.request.variants ?? []) {
        expect(variant.optionValues, item.request.name).toHaveLength(axes)
      }
    }
  })

  it('offers exactly the colours it says it comes in', () => {
    // A listing that claims 블랙 · 아이보리 and then offers a 네이비 combination is
    // the kind of inconsistency that makes seeded data obviously seeded.
    for (const item of planned) {
      const axis = (item.request.options ?? [])[0]
      const declared = new Set(item.request.attributes?.color as readonly string[])

      expect(new Set((axis?.values ?? []).map((value) => value.value))).toEqual(declared)
    }
  })
})

describe('what an ACTIVE listing has to say (F3)', () => {
  it('always fills every required attribute', () => {
    // Missing one is `PRODUCT_ATTRIBUTES_REQUIRED`, which would kill the seed
    // partway through rather than at the first row.
    for (const item of planned) {
      const required = effectiveAttributes(item.leafSlug).filter(
        (definition) => definition.isRequired === true,
      )

      for (const definition of required) {
        expect(item.request.attributes, `${item.leafSlug}/${definition.key}`).toHaveProperty(
          definition.key,
        )
      }
    }
  })

  it('only ever answers with a value the definition allows', () => {
    for (const item of planned) {
      for (const definition of effectiveAttributes(item.leafSlug)) {
        const value = item.request.attributes?.[definition.key]

        if (value === undefined) continue

        if (definition.type === 'SELECT') expect(definition.options).toContain(value)
        if (definition.type === 'MULTI_SELECT') {
          for (const entry of value as readonly string[]) {
            if (definition.key === 'color') expect(COLOURS).toContain(entry)
            else expect(definition.options).toContain(entry)
          }
        }
      }
    }
  })

  it('leaves optional attributes unanswered often enough for a facet to mean something', () => {
    // A facet every listing answers tells a reader nothing — it filters out
    // nobody. Roughly a quarter of optional answers should be missing.
    const random = seededRandom('선택')
    const filled = Array.from({ length: 400 }, () =>
      attributesFor(random, 'women-tops-tshirts', ['블랙']),
    ).filter((attributes) => 'sleeve' in attributes).length

    expect(filled).toBeGreaterThan(240)
    expect(filled).toBeLessThan(360)
  })
})

describe('the shape TASK-0037 F1 asked for', () => {
  it('averages about four combinations per listing', () => {
    const total = planned.reduce((sum, item) => sum + (item.request.variants ?? []).length, 0)

    expect(total / planned.length).toBeGreaterThan(2.5)
    expect(total / planned.length).toBeLessThan(6)
  })

  it('leaves about a tenth as drafts, so the console filter has something to do', () => {
    const drafts = planned.filter((item) => item.request.status === 'DRAFT')

    expect(drafts.length / planned.length).toBeGreaterThan(0.04)
    expect(drafts.length / planned.length).toBeLessThan(0.18)
  })

  it('sells out some combinations, which is a state the storefront has to render', () => {
    const soldOut = planned
      .flatMap((item) => item.request.variants ?? [])
      .filter((variant) => variant.stock === 0)

    expect(soldOut.length).toBeGreaterThan(0)
  })
})

describe('where each listing goes', () => {
  const leaves = leafCategories().map((leaf) => leaf.slug)
  const full = planCatalogue(SEED_SCALES.full, leaves)

  it('makes the counts F1 asks for', () => {
    expect(full).toHaveLength(800)
    expect(new Set(full.map((row) => row.sellerIndex)).size).toBe(15)
  })

  it('makes the smaller catalogue F8 asks for', () => {
    const small = planCatalogue(SEED_SCALES.small, leaves)

    expect(small).toHaveLength(50)
    expect(new Set(small.map((row) => row.sellerIndex)).size).toBe(5)
  })

  it('places every listing the same way on every run (F2)', () => {
    // Round-robin, not random. Where a listing sits is the seed's natural key;
    // if that moved, a rerun could not tell an existing listing from a new one.
    expect(planCatalogue(SEED_SCALES.full, leaves)).toEqual(full)
  })

  it('gives every store products across the whole tree, not two categories', () => {
    for (let seller = 0; seller < 15; seller += 1) {
      const mine = full.filter((row) => row.sellerIndex === seller)

      expect(new Set(mine.map((row) => row.leafSlug)).size, String(seller)).toBeGreaterThan(10)
    }
  })

  it('fills every leaf', () => {
    expect(new Set(full.map((row) => row.leafSlug)).size).toBe(leaves.length)
  })

  it('spreads the twenty showcase listings across the tree', () => {
    const showcase = full.filter((row) => row.showcase)

    expect(showcase).toHaveLength(20)
    expect(new Set(showcase.map((row) => row.leafSlug)).size).toBeGreaterThan(10)
  })

  it('refuses to plan against an empty tree', () => {
    expect(() => planCatalogue(SEED_SCALES.full, [])).toThrow('잎 카테고리가 없습니다')
  })
})

describe('seedSkuPrefix', () => {
  it('is a prefix the API accepts', () => {
    for (const index of [0, 7, 42, 799]) {
      expect(skuPrefixSchema.safeParse(seedSkuPrefix(index)).success).toBe(true)
    }
  })

  it('sorts and pads, so 800 listings keep one shape', () => {
    expect(seedSkuPrefix(0)).toBe('SEED0000')
    expect(seedSkuPrefix(799)).toBe('SEED0799')
  })

  it('is different for every listing — it is the natural key a rerun looks up', () => {
    const prefixes = Array.from({ length: 800 }, (_unused, index) => seedSkuPrefix(index))

    expect(new Set(prefixes).size).toBe(800)
  })
})

describe('what the database would refuse', () => {
  it('never prices a combination above its own struck-through price', () => {
    // `ProductVariant_list_price_check` requires `listPrice >= price`. The
    // listing-level check is not enough: a per-combination surcharge applied to
    // the price and not to the list price is a negative discount, and the
    // failure only shows up at the row that happens to draw one.
    for (const item of planned) {
      const listing = item.request.variantDefaults.listPrice

      for (const variant of item.request.variants ?? []) {
        const list = variant.listPrice ?? listing

        if (list === undefined || list === null) continue

        expect(
          list,
          `${item.request.name} / ${variant.optionValues.join('·')}`,
        ).toBeGreaterThanOrEqual(variant.price ?? item.request.variantDefaults.price)
      }
    }
  })

  it('never leaves a surcharged combination on the listing’s list price', () => {
    const surcharged = planned
      .filter((item) => item.request.variantDefaults.listPrice !== undefined)
      .flatMap((item) =>
        (item.request.variants ?? []).filter(
          (variant) => (variant.price ?? 0) > item.request.variantDefaults.price,
        ),
      )

    expect(surcharged.length).toBeGreaterThan(0)
    expect(surcharged.every((variant) => variant.listPrice !== undefined)).toBe(true)
  })
})
