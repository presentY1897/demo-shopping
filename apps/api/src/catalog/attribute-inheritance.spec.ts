import { describe, expect, it } from 'vitest'

import type { OwnedAttribute } from './attribute-inheritance.js'
import { ancestorIdsOf, resolveEffectiveAttributes } from './attribute-inheritance.js'

/**
 * Inheritance, over values only.
 *
 * The rule reads as one sentence — "상위 카테고리에서 상속" — and hides two
 * decisions: which definitions reach a category, and what happens when two of
 * them claim the same key. The second one is the reason this file exists as
 * pure logic with a 100% branch gate: the answer has to be a function of the
 * rows, not of the order the database happened to return them.
 */

interface Row extends OwnedAttribute {
  readonly label?: string
}

let nextId = 0

function row(categoryId: number, key: string, overrides: Partial<Row> = {}): Row {
  nextId += 1

  return { id: nextId, categoryId, key, sortOrder: 0, ...overrides }
}

/** The keys of a resolution, in the order it produced them. */
function keysOf(rows: readonly Row[], lineage: readonly number[]): string[] {
  return resolveEffectiveAttributes(rows, lineage).map((attribute) => attribute.key)
}

describe('ancestorIdsOf', () => {
  it('reads a three-level path, roots first', () => {
    expect(ancestorIdsOf('/1/5/12/')).toEqual([1, 5, 12])
  })

  it('reads a root', () => {
    expect(ancestorIdsOf('/1/')).toEqual([1])
  })

  it('reads the empty path as no lineage at all', () => {
    expect(ancestorIdsOf('/')).toEqual([])
  })
})

describe('a three-level lineage', () => {
  // 의류(1) > 상의(5) > 코트(12), the shape every criterion in F1 is about.
  const lineage = [1, 5, 12]

  it('gives a leaf everything its ancestors defined (F1)', () => {
    const rows = [row(1, 'brand'), row(5, 'fit'), row(12, 'lining')]

    expect(keysOf(rows, lineage)).toEqual(['brand', 'fit', 'lining'])
  })

  it('marks the ancestors inherited and the category is own', () => {
    const rows = [row(1, 'brand'), row(5, 'fit'), row(12, 'lining')]
    const resolved = resolveEffectiveAttributes(rows, lineage)

    expect(resolved.map((attribute) => [attribute.key, attribute.inherited])).toEqual([
      ['brand', true],
      ['fit', true],
      ['lining', false],
    ])
  })

  it('gives a root only its own definitions', () => {
    const rows = [row(1, 'brand'), row(5, 'fit')]

    // Asked about 의류 itself, 상의's definition is not in the lineage at all.
    expect(keysOf(rows, [1])).toEqual(['brand'])
  })

  it('carries the whole row through, not just the fields it sorted by', () => {
    const [resolved] = resolveEffectiveAttributes([row(1, 'brand', { label: '브랜드' })], lineage)

    expect(resolved).toMatchObject({ key: 'brand', label: '브랜드', inherited: true })
  })

  it('answers with nothing when no definition exists', () => {
    expect(resolveEffectiveAttributes([], lineage)).toEqual([])
  })

  it('ignores a definition owned by a category outside the lineage', () => {
    // A caller that passed the wrong lineage would otherwise attach an
    // attribute to a category that never inherited it.
    expect(keysOf([row(1, 'brand'), row(99, 'stray')], lineage)).toEqual(['brand'])
  })
})

describe('the same key twice in one lineage', () => {
  const lineage = [1, 5, 12]

  it('lets the nearest definition win, whichever order the rows arrive in', () => {
    const shallow = row(1, 'brand', { label: '루트' })
    const deep = row(12, 'brand', { label: '잎' })

    // This state is not reachable through the API — `AttributeService` refuses
    // it — but a category move creates it without asking (TASK-0030 4.1), and
    // the answer must not depend on the row order.
    expect(resolveEffectiveAttributes([shallow, deep], lineage)[0]).toMatchObject({
      label: '잎',
      inherited: false,
    })
    expect(resolveEffectiveAttributes([deep, shallow], lineage)[0]).toMatchObject({
      label: '잎',
      inherited: false,
    })
  })

  it('keeps exactly one entry per key', () => {
    expect(keysOf([row(1, 'brand'), row(5, 'brand'), row(12, 'brand')], lineage)).toEqual(['brand'])
  })

  it('breaks a tie on one category by sortOrder, then by id', () => {
    // Two live definitions of one key on one category are refused by
    // `AttributeDefinition_categoryId_key_active_key`. The tie-break is here so
    // that the resolver is a function of its input even then.
    const later = row(5, 'brand', { sortOrder: 3, label: '뒤' })
    const earlier = row(5, 'brand', { sortOrder: 1, label: '앞' })

    expect(resolveEffectiveAttributes([later, earlier], lineage)[0]).toMatchObject({ label: '앞' })

    const first = row(5, 'fit', { id: 10, label: '먼저' })
    const second = row(5, 'fit', { id: 20, label: '나중' })

    expect(resolveEffectiveAttributes([second, first], lineage)[0]).toMatchObject({
      label: '먼저',
    })
  })
})

describe('order of the answer', () => {
  const lineage = [1, 5, 12]

  it('puts ancestors before descendants, general before specific', () => {
    const rows = [row(12, 'lining'), row(1, 'brand'), row(5, 'fit')]

    expect(keysOf(rows, lineage)).toEqual(['brand', 'fit', 'lining'])
  })

  it("respects the owner's sortOrder within one category", () => {
    const rows = [row(5, 'b', { sortOrder: 2 }), row(5, 'a', { sortOrder: 1 })]

    expect(keysOf(rows, lineage)).toEqual(['a', 'b'])
  })

  it('falls back to the id when two definitions share a position', () => {
    const rows = [row(5, 'later', { id: 300 }), row(5, 'earlier', { id: 200 })]

    // Same category, same sortOrder: without this the answer would depend on
    // insertion order in a `Map`, which is stable but not meaningful.
    expect(keysOf(rows, lineage)).toEqual(['earlier', 'later'])
  })

  it('sorts an ancestor first even when its position is higher', () => {
    const rows = [row(12, 'lining', { sortOrder: 0 }), row(1, 'brand', { sortOrder: 9 })]

    expect(keysOf(rows, lineage)).toEqual(['brand', 'lining'])
  })
})
