import { LOW_STOCK_THRESHOLD, sellerStockFilters } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  isLowStock,
  nameSearchPattern,
  SEARCH_ESCAPE,
  stockBandOf,
  stockBoundsOf,
} from './seller-product-filters.js'

/** Wide enough to pass the threshold in both directions. */
const RANGE = Array.from({ length: LOW_STOCK_THRESHOLD * 3 + 4 }, (_unused, index) => index)

/** Whether `total` satisfies the bounds a filter produced, as the query does. */
function matches(total: number, bounds: { min: number | null; max: number | null }): boolean {
  return (
    (bounds.min === null || total >= bounds.min) && (bounds.max === null || total <= bounds.max)
  )
}

describe('stockBandOf', () => {
  it('calls nothing 품절', () => {
    expect(stockBandOf(0)).toBe('out')
  })

  it('calls one unit 품절 임박, not 품절', () => {
    expect(stockBandOf(1)).toBe('low')
  })

  it('includes the threshold itself', () => {
    expect(stockBandOf(LOW_STOCK_THRESHOLD)).toBe('low')
  })

  it('stops one past the threshold', () => {
    expect(stockBandOf(LOW_STOCK_THRESHOLD + 1)).toBe('ok')
  })

  /**
   * `stock` is a non-negative column and the sum of live variants cannot be
   * negative either — but a band function that answered `ok` for -1 would be a
   * silent hole if a reservation ever made the difference negative (M07).
   */
  it('treats a negative total as 품절', () => {
    expect(stockBandOf(-1)).toBe('out')
  })
})

describe('isLowStock', () => {
  it('is false for a sold-out listing', () => {
    // The whole reason the band has three values: a row that claimed both would
    // make the screen choose which badge to draw (TASK-0115 4장).
    expect(isLowStock(0)).toBe(false)
  })

  it('is true exactly on the low band', () => {
    expect(RANGE.filter(isLowStock)).toEqual(
      RANGE.filter((total) => total >= 1 && total <= LOW_STOCK_THRESHOLD),
    )
  })
})

describe('stockBoundsOf', () => {
  it('bounds nothing when no filter is given', () => {
    expect(stockBoundsOf(undefined)).toEqual({ min: null, max: null })
  })

  it.each(sellerStockFilters)('selects exactly the %s band', (filter) => {
    // The duplication that has to stay honest: the badge is decided in
    // TypeScript and the filter in SQL, so the two are held against each other
    // over the whole range rather than at a hand-picked value.
    const selected = RANGE.filter((total) => matches(total, stockBoundsOf(filter)))

    expect(selected).toEqual(RANGE.filter((total) => stockBandOf(total) === filter))
  })

  it('never lets one total match both filters', () => {
    const both = RANGE.filter((total) =>
      sellerStockFilters.every((filter) => matches(total, stockBoundsOf(filter))),
    )

    expect(both).toEqual([])
  })
})

describe('nameSearchPattern', () => {
  it('is absent when nothing was asked for', () => {
    expect(nameSearchPattern(undefined)).toBeNull()
  })

  it('is absent for a search of only whitespace', () => {
    expect(nameSearchPattern('   ')).toBeNull()
  })

  it('matches a substring', () => {
    expect(nameSearchPattern('티셔츠')).toBe('%티셔츠%')
  })

  it('trims what the caller typed', () => {
    expect(nameSearchPattern('  티셔츠 ')).toBe('%티셔츠%')
  })

  it('escapes the wildcard so a percent sign is looked for literally', () => {
    expect(nameSearchPattern('50%')).toBe(`%50${SEARCH_ESCAPE}%%`)
  })

  it('escapes the single-character wildcard', () => {
    expect(nameSearchPattern('A_1')).toBe(`%A${SEARCH_ESCAPE}_1%`)
  })

  it('escapes the escape character itself', () => {
    expect(nameSearchPattern('a\\b')).toBe(`%a${SEARCH_ESCAPE}\\b%`)
  })
})
