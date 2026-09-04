/**
 * The one place a shopper's words reach the engine's syntax.
 *
 * QUALITY-GATES Q5 순수 로직: a mistake here is either a query that fails or,
 * worse, one that quietly matches the wrong rows — and the second kind returns
 * results, so nothing looks broken.
 */

import { describe, expect, it } from 'vitest'

import {
  decodeCursor,
  encodeCursor,
  filterExpression,
  nextCursorFor,
  quote,
  toSearchRequest,
} from './search-query.js'

describe('quote', () => {
  it('escapes what would otherwise end the string early', () => {
    // A value with a quote in it is a value that changes what the filter means.
    expect(quote('린넨')).toBe('"린넨"')
    expect(quote('20" 데님')).toBe('"20\\" 데님"')
    expect(quote('a\\b')).toBe('"a\\\\b"')
  })
})

describe('filterExpression', () => {
  it('is null when nothing was asked for', () => {
    expect(filterExpression({})).toBeNull()
  })

  it('ands the scalar filters together', () => {
    expect(filterExpression({ categoryId: 3, priceMin: 10_000, priceMax: 50_000 })).toBe(
      'categoryId = 3 AND price >= 10000 AND price <= 50000',
    )
  })

  it('only narrows to in-stock when asked', () => {
    // Absent means "show everything", not "show sold out" — a tri-state that a
    // boolean column cannot express, so absence has to be the third value.
    expect(filterExpression({ inStock: true })).toBe('inStock = true')
    expect(filterExpression({ inStock: false })).toBeNull()
  })

  it('ors the values of one attribute and ands different ones', () => {
    // Two values under 소재 means "either"; adding a fit means "and also". The
    // other way round makes every second checkbox return nothing.
    expect(filterExpression({ attributes: { material: ['면', '린넨'], fit: ['루즈'] } })).toBe(
      '(attr_material = "면" OR attr_material = "린넨") AND attr_fit = "루즈"',
    )
  })

  it('does not wrap a single value in parentheses it does not need', () => {
    expect(filterExpression({ attributes: { material: ['면'] } })).toBe('attr_material = "면"')
  })

  it('escapes attribute values, which come from a shopper’s click', () => {
    expect(filterExpression({ attributes: { note: ['그는 "말"했다'] } })).toBe(
      'attr_note = "그는 \\"말\\"했다"',
    )
  })
})

describe('the cursor', () => {
  it('round-trips an offset', () => {
    expect(decodeCursor(encodeCursor(40))).toBe(40)
  })

  it('is a first page for a cursor that means nothing', () => {
    // A stale link is a first page, not a failure.
    expect(decodeCursor(undefined)).toBe(0)
    expect(decodeCursor('!!!not base64!!!')).toBe(0)
    expect(decodeCursor(encodeCursor(-5))).toBe(0)
  })

  it('is opaque, so the day it can be a real key nothing else changes', () => {
    expect(encodeCursor(40)).not.toBe('40')
  })
})

describe('toSearchRequest', () => {
  it('asks for the engine’s own ranking when no sort was chosen', () => {
    expect(toSearchRequest({}, []).sort).toEqual([])
  })

  it('maps each sort to a field the index declares sortable', () => {
    expect(toSearchRequest({ sort: 'price_asc' }, []).sort).toEqual(['price:asc'])
    expect(toSearchRequest({ sort: 'newest' }, []).sort).toEqual(['createdAt:desc'])
    expect(toSearchRequest({ sort: 'sales' }, []).sort).toEqual(['salesCount:desc'])
    expect(toSearchRequest({ sort: 'rating' }, []).sort).toEqual(['ratingAvg:desc'])
  })

  it('searches for everything when no term was typed', () => {
    // An empty `q` is a browse, and a browse is what a category page is.
    expect(toSearchRequest({}, []).q).toBe('')
  })

  it('starts where the cursor says', () => {
    expect(toSearchRequest({ cursor: encodeCursor(60) }, []).offset).toBe(60)
  })
})

describe('nextCursorFor', () => {
  const request = { q: '', filter: null, sort: [], offset: 0, limit: 20, facets: [] }

  it('offers another page while there is one', () => {
    expect(nextCursorFor(request, 100)).toBe(encodeCursor(20))
  })

  it('stops at the end', () => {
    expect(nextCursorFor(request, 20)).toBeNull()
    expect(nextCursorFor(request, 12)).toBeNull()
  })

  it('stops from the middle too', () => {
    expect(nextCursorFor({ ...request, offset: 80 }, 100)).toBeNull()
    expect(nextCursorFor({ ...request, offset: 60 }, 100)).toBe(encodeCursor(80))
  })
})
