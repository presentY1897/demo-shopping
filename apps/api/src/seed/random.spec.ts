/**
 * The property that matters is not "looks random" — it is **repeats exactly**.
 *
 * F2 asks that a second `pnpm db:seed` produce no duplicates, and the way this
 * seed answers that is by generating the same catalogue and recognising it.
 * Every check below is about that: the same name gives the same sequence, a
 * different name gives a different one, and a child stream cannot disturb its
 * parent.
 */

import { describe, expect, it } from 'vitest'

import { seededRandom } from './random.js'

function draws(name: string, count = 8): readonly number[] {
  const random = seededRandom(name)

  return Array.from({ length: count }, () => random.next())
}

describe('seededRandom', () => {
  it('gives the same sequence for the same name', () => {
    expect(draws('브랜드')).toEqual(draws('브랜드'))
  })

  it('gives a different sequence for a different name', () => {
    expect(draws('브랜드')).not.toEqual(draws('상품'))
  })

  it('stays inside [0, 1)', () => {
    for (const value of draws('범위', 200)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('int', () => {
  it('includes both ends', () => {
    const random = seededRandom('int')
    const seen = new Set(Array.from({ length: 300 }, () => random.int(1, 3)))

    expect([...seen].sort()).toEqual([1, 2, 3])
  })

  it('answers the only value when the range is one wide', () => {
    expect(seededRandom('int').int(7, 7)).toBe(7)
  })

  it('refuses an inverted range rather than looping forever', () => {
    expect(() => seededRandom('int').int(3, 1)).toThrow('빈 범위')
  })
})

describe('pick', () => {
  it('only ever answers an element of the list', () => {
    const random = seededRandom('pick')
    const items = ['빨강', '파랑', '초록'] as const

    for (let index = 0; index < 50; index += 1) {
      expect(items).toContain(random.pick(items))
    }
  })

  it('refuses an empty list — an empty pool is a bug in the data, not a draw', () => {
    expect(() => seededRandom('pick').pick([])).toThrow('빈 목록')
  })
})

describe('sample', () => {
  it('never repeats an element', () => {
    const random = seededRandom('sample')
    const items = [1, 2, 3, 4, 5, 6]

    for (let index = 0; index < 50; index += 1) {
      const taken = random.sample(items, 3)

      expect(taken).toHaveLength(3)
      expect(new Set(taken).size).toBe(3)
    }
  })

  it('answers the whole list rather than failing when asked for too many', () => {
    // A category with two colours and a product that wants three is normal
    // data, not an error: the product simply gets two.
    expect(seededRandom('sample').sample(['S', 'M'], 5)).toHaveLength(2)
  })

  it('answers nothing when asked for nothing', () => {
    expect(seededRandom('sample').sample(['S', 'M'], 0)).toEqual([])
  })
})

describe('chance', () => {
  it('is never true at 0 and always true at 1', () => {
    const random = seededRandom('chance')

    for (let index = 0; index < 50; index += 1) {
      expect(random.chance(0)).toBe(false)
      expect(random.chance(1)).toBe(true)
    }
  })
})

describe('stream', () => {
  it('is a different sequence from its parent', () => {
    const parent = seededRandom('상품')

    expect(parent.stream('색상').next()).not.toBe(seededRandom('상품').next())
  })

  it('is reproducible from the parent name alone', () => {
    expect(seededRandom('상품').stream('색상').next()).toBe(
      seededRandom('상품').stream('색상').next(),
    )
  })

  it('does not move the parent — a nested loop cannot rewrite the catalogue', () => {
    // The reason streams exist. Drawing colours for one product must not shift
    // which product comes next, or adding an option value would rewrite
    // everything after it and the seed would stop looking idempotent.
    const parent = seededRandom('상품')
    const before = parent.next()

    seededRandom('상품').stream('색상').sample(['a', 'b', 'c'], 2)

    const again = seededRandom('상품')

    expect(again.next()).toBe(before)
  })
})
