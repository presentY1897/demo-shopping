/**
 * The document, as pure input to output (QUALITY-GATES Q5 순수 로직).
 *
 * A wrong document is not a failed request — it is a listing that is findable
 * under the wrong words, or a facet that counts nothing, and neither of those
 * shows up anywhere except in a search somebody runs later.
 */

import { describe, expect, it } from 'vitest'

import type { ProductSource } from './search-document.js'
import {
  ATTRIBUTE_FACET_PREFIX,
  attributeFacets,
  isIndexable,
  toDocument,
} from './search-document.js'

function source(overrides: Partial<ProductSource> = {}): ProductSource {
  return {
    id: '0192f0c1-0000-7000-8000-000000000001',
    name: '데일리 코튼 티셔츠',
    description: '매일 입기 좋은 티셔츠입니다.',
    status: 'ACTIVE',
    sellerId: '0192f0c1-0000-7000-8000-000000000002',
    brandName: '해뜰녘',
    categoryId: 12,
    categoryPath: ['여성', '상의', '티셔츠'],
    minPrice: 29_900,
    ratingAvg: 450,
    ratingCount: 12,
    salesCount: 30,
    attributes: { material: '면', color: ['블랙', '화이트'] },
    totalStock: 42,
    thumbnailUrl: 'https://cdn.test.invalid/a.jpg',
    createdAt: new Date('2026-09-05T00:00:00.000Z'),
    ...overrides,
  }
}

describe('isIndexable', () => {
  it('is only true for a listing that is on sale', () => {
    // F3: a draft or a suspended listing must not be findable, and the decision
    // is here rather than in the query so the worker can be handed any product.
    expect(isIndexable({ status: 'ACTIVE' })).toBe(true)
    expect(isIndexable({ status: 'DRAFT' })).toBe(false)
    expect(isIndexable({ status: 'INACTIVE' })).toBe(false)
    expect(isIndexable({ status: 'SUSPENDED' })).toBe(false)
  })
})

describe('attributeFacets', () => {
  it('prefixes every key so the facet name cannot collide with a field', () => {
    // `name` as an attribute would otherwise overwrite the listing's name.
    expect(attributeFacets({ name: '겹침' })).toEqual({ [`${ATTRIBUTE_FACET_PREFIX}name`]: '겹침' })
  })

  it('keeps a multi-valued attribute as a list', () => {
    // A listing in three colours has to be found by any one of them.
    expect(attributeFacets({ color: ['블랙', '화이트'] })).toEqual({
      attr_color: ['블랙', '화이트'],
    })
  })

  it('keeps numbers and booleans as themselves', () => {
    // A numeric facet is filtered with `>=`; stringifying it would make every
    // comparison lexicographic and `100` smaller than `20`.
    expect(attributeFacets({ heel_mm: 70, laptop_ok: true })).toEqual({
      attr_heel_mm: 70,
      attr_laptop_ok: true,
    })
  })

  it('answers nothing for a listing with no attributes', () => {
    expect(attributeFacets({})).toEqual({})
  })
})

describe('toDocument', () => {
  it('flattens the attributes beside the fields', () => {
    const document = toDocument(source())

    expect(document.attr_material).toBe('면')
    expect(document.attr_color).toEqual(['블랙', '화이트'])
  })

  it('makes the lineage searchable as one string', () => {
    // A shopper types 「여성 티셔츠」, which matches nothing if the lineage is
    // only an array of separate tokens in separate documents.
    expect(toDocument(source()).categoryLabel).toBe('여성 > 상의 > 티셔츠')
  })

  it('carries stock as a boolean, not a number (R3)', () => {
    expect(toDocument(source({ totalStock: 42 })).inStock).toBe(true)
    expect(toDocument(source({ totalStock: 0 })).inStock).toBe(false)
  })

  it('sorts by an epoch number rather than an ISO string', () => {
    // Lexicographic order happens to be right for UTC and is silently wrong the
    // day a value carries an offset.
    expect(toDocument(source()).createdAt).toBe(Date.parse('2026-09-05T00:00:00.000Z') / 1000)
  })

  it('gives a listing with no live combination a price rather than a null', () => {
    // A sortable field that is sometimes absent sorts unpredictably.
    expect(toDocument(source({ minPrice: null })).price).toBe(0)
  })

  it('does not put a null into a searchable field', () => {
    // A `null` in a searchable field is a value a search for "null" can match.
    expect(toDocument(source({ description: null })).description).toBe('')
  })

  it('never lets an attribute overwrite a field of the document', () => {
    const document = toDocument(source({ attributes: { name: '속성이 이긴다면 버그' } }))

    expect(document.name).toBe('데일리 코튼 티셔츠')
    expect(document.attr_name).toBe('속성이 이긴다면 버그')
  })

  it('leaves the hangul field for TASK-0103', () => {
    expect(toDocument(source()).hangul).toEqual([])
  })
})
