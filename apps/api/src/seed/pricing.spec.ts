/**
 * F5 is a number, so it is checked as one.
 *
 * "가격 히스토그램 확인 — 최저~최고 20배 이상 분산" is the completion criterion,
 * and the failure it guards against is invisible: a flat catalogue does not
 * break the price filter, it makes the filter look like it does nothing. So the
 * spread is asserted here rather than eyeballed after a seed run.
 */

import { priceSchema } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { priceFor, sectionOf, variantSurcharge } from './pricing.js'
import { seededRandom } from './random.js'
import { leafCategories } from './taxonomy.js'

/** Every price the catalogue would contain, at the scale the task asks for. */
function catalogue(): readonly number[] {
  const random = seededRandom('가격')

  return leafCategories().flatMap((leaf) =>
    Array.from({ length: 32 }, () => priceFor(random, leaf.slug).price),
  )
}

describe('sectionOf', () => {
  it('reads the section from the middle, not from the end', () => {
    // `dress-shoes` is one leaf name with a hyphen in it. Counting from the end
    // would file it under a section called `dress`, which has no price band.
    expect(sectionOf('men-shoes-dress-shoes')).toBe('shoes')
    expect(sectionOf('women-bottoms-jeans')).toBe('bottoms')
  })

  it('refuses a slug that has no section', () => {
    expect(() => sectionOf('women')).toThrow('섹션을 알 수 없는')
  })
})

describe('priceFor', () => {
  it('covers every leaf the taxonomy has', () => {
    const random = seededRandom('전부')

    for (const leaf of leafCategories()) {
      expect(() => priceFor(random, leaf.slug), leaf.slug).not.toThrow()
    }
  })

  it('refuses a section with no band rather than inventing a price', () => {
    expect(() => priceFor(seededRandom('x'), 'women-unknown-thing')).toThrow('가격대가 없는')
  })

  it('produces a price the API accepts', () => {
    for (const price of catalogue()) {
      expect(priceSchema.safeParse(price).success).toBe(true)
    }
  })

  it('spreads at least 20× from cheapest to dearest (F5)', () => {
    const prices = catalogue()
    const spread = Math.max(...prices) / Math.min(...prices)

    expect(spread).toBeGreaterThanOrEqual(20)
  })

  it('leans cheap, with a thin tail — not a flat band', () => {
    // A uniform draw would put as many ₩600,000 coats on page one as ₩100,000
    // ones, and no real category's first page looks like that.
    const prices = [...catalogue()].sort((a, b) => a - b)
    const median = prices[Math.floor(prices.length / 2)] ?? 0
    const mean = prices.reduce((sum, value) => sum + value, 0) / prices.length

    expect(median).toBeLessThan(mean)
  })

  it('prints prices a shop would print', () => {
    for (const price of catalogue()) {
      expect(price % 1_000, String(price)).toBe(900)
    }
  })

  it('puts some listings on sale and not most of them', () => {
    const random = seededRandom('세일')
    const rows = Array.from({ length: 400 }, () => priceFor(random, 'women-tops-knits'))
    const onSale = rows.filter((row) => row.listPrice !== null)

    expect(onSale.length).toBeGreaterThan(40)
    expect(onSale.length).toBeLessThan(200)
  })

  it('never claims a sale price above the price it struck through', () => {
    const random = seededRandom('세일')

    for (let index = 0; index < 400; index += 1) {
      const row = priceFor(random, 'women-outer-coats')

      if (row.listPrice !== null) expect(row.listPrice).toBeGreaterThan(row.price)
    }
  })
})

describe('variantSurcharge', () => {
  it('is usually nothing', () => {
    const random = seededRandom('추가금')
    const rows = Array.from({ length: 400 }, () => variantSurcharge(random, 50_000))

    expect(rows.filter((value) => value === 0).length).toBeGreaterThan(240)
  })

  it('is a round step a shop would charge', () => {
    const random = seededRandom('추가금')

    for (let index = 0; index < 400; index += 1) {
      expect(variantSurcharge(random, 50_000) % 1_000).toBe(0)
      expect(variantSurcharge(random, 250_000) % 1_000).toBe(0)
    }
  })

  it('scales the step to the listing', () => {
    const random = seededRandom('추가금')
    const cheap = Array.from({ length: 200 }, () => variantSurcharge(random, 20_000))
    const dear = Array.from({ length: 200 }, () => variantSurcharge(random, 400_000))

    expect(Math.max(...cheap)).toBeLessThan(Math.max(...dear))
  })
})
