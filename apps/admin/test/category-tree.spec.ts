/**
 * The arithmetic behind the tree, checked without a DOM.
 *
 * These functions decide what is drawn, what the arrow keys walk, which move
 * buttons are live and what request each one becomes. They are pure, so
 * QUALITY-GATES Q5 asks for **branch** coverage rather than an interaction
 * list — every refusal `planMove` can return is exercised below, because each
 * one is also a disabled button somebody could otherwise ship as enabled.
 */

import { categoryTree } from '@shopping/api-mocks'
import { describe, expect, it } from 'vitest'

import type { CategoryRow } from '@/lib/categories/tree'
import {
  applyPlan,
  branchIds,
  canAddChild,
  childrenOf,
  hasChildren,
  levelOf,
  mergeRows,
  planMove,
  rowById,
  subtreeHeight,
  toRows,
  visibleRows,
} from '@/lib/categories/tree'

const rows = toRows(categoryTree.nodes)

/** A three level tree small enough to reason about, built the way the API answers. */
function sample(): CategoryRow[] {
  const row = (
    id: number,
    parentId: number | null,
    sortOrder: number,
    name = `n${String(id)}`,
  ): CategoryRow => ({
    id,
    parentId,
    name,
    slug: `s${String(id)}`,
    sortOrder,
    isActive: true,
    productCount: 0,
    version: 0,
  })

  return [
    row(1, null, 0, 'A'),
    row(2, null, 1, 'B'),
    row(10, 1, 0, 'A1'),
    row(11, 1, 1, 'A2'),
    row(100, 10, 0, 'A1a'),
  ]
}

const ids = (list: readonly CategoryRow[]): number[] => list.map((row) => row.id)

describe('reading the tree', () => {
  it('flattens the API answer and drops the fields only the server can keep true', () => {
    expect(rows).toHaveLength(40)
    expect(rows[0]).not.toHaveProperty('path')
    expect(rows[0]).not.toHaveProperty('depth')
    expect(rows[0]).not.toHaveProperty('children')
  })

  it('orders siblings by sortOrder, then by id', () => {
    const shuffled = [
      { ...sample()[0]!, id: 5, sortOrder: 1 },
      { ...sample()[0]!, id: 4, sortOrder: 1 },
      { ...sample()[0]!, id: 3, sortOrder: 0 },
    ]

    expect(ids(childrenOf(shuffled, null))).toEqual([3, 4, 5])
  })

  it('computes the level from the parent chain, not from a stored field', () => {
    expect(levelOf(sample(), 100)).toBe(3)
    expect(levelOf(sample(), 1)).toBe(1)
    expect(levelOf(sample(), 999)).toBe(0)
  })

  it('measures how many levels a subtree occupies', () => {
    expect(subtreeHeight(sample(), 1)).toBe(3)
    expect(subtreeHeight(sample(), 11)).toBe(1)
  })

  it('hides a collapsed subtree from the visible order', () => {
    const all = visibleRows(sample(), new Set(branchIds(sample())))
    const collapsed = visibleRows(sample(), new Set([1]))

    expect(all.map((item) => item.row.id)).toEqual([1, 10, 100, 11, 2])
    expect(collapsed.map((item) => item.row.id)).toEqual([1, 10, 11, 2])
  })

  it('describes each row the way ARIA needs it', () => {
    const [first, second] = visibleRows(sample(), new Set(branchIds(sample())))

    expect(first).toMatchObject({ level: 1, position: 1, siblingCount: 2, hasChildren: true })
    expect(second).toMatchObject({ level: 2, position: 1, siblingCount: 2, childCount: 1 })
  })

  it('knows which nodes can hold children and which block a delete', () => {
    expect(hasChildren(sample(), 1)).toBe(true)
    expect(hasChildren(sample(), 100)).toBe(false)
    expect(canAddChild(sample(), 10)).toBe(true)
    expect(canAddChild(sample(), 100)).toBe(false)
    expect(rowById(sample(), 100)?.name).toBe('A1a')
  })
})

describe('planning a move', () => {
  it('turns up and down into the whole sibling arrangement', () => {
    expect(planMove(sample(), 11, 'up')).toEqual({
      kind: 'reorder',
      parentId: 1,
      orderedIds: [11, 10],
    })
    expect(planMove(sample(), 1, 'down')).toEqual({
      kind: 'reorder',
      parentId: null,
      orderedIds: [2, 1],
    })
  })

  it('refuses to move the first sibling up or the last one down', () => {
    expect(planMove(sample(), 10, 'up')).toBeNull()
    expect(planMove(sample(), 2, 'down')).toBeNull()
  })

  it('lifts a node to its grandparent, or to the top level', () => {
    expect(planMove(sample(), 100, 'out')).toEqual({ kind: 'move', id: 100, parentId: 1 })
    expect(planMove(sample(), 10, 'out')).toEqual({ kind: 'move', id: 10, parentId: null })
  })

  it('refuses to lift a root, which has nowhere to go', () => {
    expect(planMove(sample(), 1, 'out')).toBeNull()
  })

  it('tucks a node under its previous sibling', () => {
    expect(planMove(sample(), 11, 'in')).toEqual({ kind: 'move', id: 11, parentId: 10 })
  })

  it('refuses to tuck the first sibling in, having nothing to tuck under', () => {
    expect(planMove(sample(), 10, 'in')).toBeNull()
    expect(planMove(sample(), 1, 'in')).toBeNull()
  })

  it('refuses a move that would push the subtree past three levels', () => {
    // B is given a subtree three levels tall. Tucking it under A would put its
    // deepest node at level four, which the database's CHECK refuses as well.
    const deep = [
      ...sample(),
      { ...sample()[4]!, id: 101, parentId: 2, sortOrder: 0 },
      { ...sample()[4]!, id: 1010, parentId: 101, sortOrder: 0 },
    ]

    expect(subtreeHeight(deep, 2)).toBe(3)
    expect(planMove(deep, 2, 'in')).toBeNull()
    // Without that third level the very same move is allowed, so the cap is what
    // refused it rather than the direction.
    expect(planMove(sample(), 2, 'in')).toEqual({ kind: 'move', id: 2, parentId: 1 })
  })

  it('answers null for an id that is not in the tree', () => {
    expect(planMove(sample(), 999, 'up')).toBeNull()
  })
})

describe('drawing the move before the API answers', () => {
  it('renumbers only the siblings the arrangement names', () => {
    const plan = planMove(sample(), 11, 'up')
    const after = applyPlan(sample(), plan!)

    expect(ids(childrenOf(after, 1))).toEqual([11, 10])
    // Everything else is untouched — a reorder is not a rewrite of the tree.
    expect(ids(childrenOf(after, null))).toEqual([1, 2])
  })

  it('re-parents a node and puts it after the last sibling, as the API does', () => {
    const after = applyPlan(sample(), { kind: 'move', id: 100, parentId: null })

    expect(rowById(after, 100)?.parentId).toBeNull()
    expect(rowById(after, 100)?.sortOrder).toBe(2)
    expect(ids(childrenOf(after, null))).toEqual([1, 2, 100])
  })

  it('writes nothing but parentId and sortOrder', () => {
    const before = rowById(sample(), 100)!
    const after = rowById(applyPlan(sample(), { kind: 'move', id: 100, parentId: 2 }), 100)!

    expect({ ...after, parentId: before.parentId, sortOrder: before.sortOrder }).toEqual(before)
  })

  it('takes the rows the API answered with and leaves the rest alone', () => {
    const merged = mergeRows(sample(), [{ ...rowById(sample(), 10)!, name: '고침', version: 3 }])

    expect(rowById(merged, 10)).toMatchObject({ name: '고침', version: 3 })
    expect(rowById(merged, 11)).toEqual(rowById(sample(), 11))
  })
})
