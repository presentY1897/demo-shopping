import type { CategoryNode } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { buildCategoryForest, flattenCategoryForest } from './category-tree.js'

/**
 * Pure logic — gate Q5 asks for 100% branch coverage.
 *
 * What is being pinned down is the answer to "one query came back flat, what
 * does the nested response look like", including the two cases that are easy to
 * get wrong: a subtree read whose root has a parent outside the result, and a
 * filtered read where a hidden branch must take its children with it.
 */

function node(id: number, parentId: number | null, path: string, sortOrder = 0): CategoryNode {
  return {
    id,
    parentId,
    path,
    depth: path.split('/').filter((segment) => segment !== '').length,
    name: `카테고리 ${String(id)}`,
    slug: `category-${String(id)}`,
    sortOrder,
    isActive: true,
    version: 0,
  }
}

/** Shallowest first, as the service's `ORDER BY depth, sortOrder, id` returns. */
const rows: CategoryNode[] = [
  node(1, null, '/1/', 0),
  node(9, null, '/9/', 1),
  node(5, 1, '/1/5/', 0),
  node(6, 1, '/1/6/', 1),
  node(12, 5, '/1/5/12/', 0),
]

describe('buildCategoryForest', () => {
  it('nests the whole tree under its roots', () => {
    const forest = buildCategoryForest(rows)

    expect(forest.map((root) => root.id)).toEqual([1, 9])
    expect(forest[0]?.children.map((child) => child.id)).toEqual([5, 6])
    expect(forest[0]?.children[0]?.children.map((child) => child.id)).toEqual([12])
    expect(forest[1]?.children).toEqual([])
  })

  it('keeps the order the rows arrived in', () => {
    const reversed = [rows[0], rows[1], rows[3], rows[2], rows[4]] as CategoryNode[]

    expect(buildCategoryForest(reversed)[0]?.children.map((child) => child.id)).toEqual([6, 5])
  })

  it('returns an empty forest for no rows', () => {
    expect(buildCategoryForest([])).toEqual([])
  })

  it('roots a subtree read at the node that was asked for', () => {
    // Node 5's own parent is not in the result — the query selected `/1/5/%`.
    const subtree = [rows[2], rows[4]] as CategoryNode[]
    const forest = buildCategoryForest(subtree, 5)

    expect(forest.map((root) => root.id)).toEqual([5])
    expect(forest[0]?.children.map((child) => child.id)).toEqual([12])
  })

  it('drops a node whose parent was filtered out, and its descendants with it', () => {
    // Category 5 is inactive and therefore absent; 12 must not resurface at the
    // top level, or hiding a branch would expose exactly what it was hiding.
    const filtered = [rows[0], rows[1], rows[3], rows[4]] as CategoryNode[]
    const forest = buildCategoryForest(filtered)

    expect(forest.map((root) => root.id)).toEqual([1, 9])
    expect(forest[0]?.children.map((child) => child.id)).toEqual([6])
    expect(flattenCategoryForest(forest).map((entry) => entry.id)).toEqual([1, 6, 9])
  })

  it('drops a root that is not the requested one during a subtree read', () => {
    const forest = buildCategoryForest(rows, 5)

    expect(forest.map((root) => root.id)).toEqual([5])
    expect(flattenCategoryForest(forest).map((entry) => entry.id)).toEqual([5, 12])
  })

  it('returns nothing when the requested root is absent from the rows', () => {
    expect(buildCategoryForest([rows[4]!], 5)).toEqual([])
  })
})

describe('flattenCategoryForest', () => {
  it('lists parents before their children', () => {
    expect(flattenCategoryForest(buildCategoryForest(rows)).map((entry) => entry.id)).toEqual([
      1, 5, 12, 6, 9,
    ])
  })

  it('flattens an empty forest to nothing', () => {
    expect(flattenCategoryForest([])).toEqual([])
  })
})
