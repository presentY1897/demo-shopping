import type { CategoryNode, CategoryTreeNode } from '@shopping/shared'
import { CATEGORY_MAX_DEPTH } from '@shopping/shared'

/**
 * A category as the console holds it while it is being edited.
 *
 * `path` and `depth` are deliberately dropped. Both are derived from the whole
 * subtree and only the server can recompute them, so a screen that moves a node
 * optimistically would be carrying two fields that say where the node *used* to
 * be — and nothing would stop a later component from reading them. Taking them
 * out makes the stale state unrepresentable; the level is computed from the
 * `parentId` chain instead, which the optimistic update does keep correct.
 *
 * It is `Omit` of the contract type rather than a fresh interface: gate C1 says
 * an app must not redefine a response shape, and this way a field renamed in
 * `packages/shared` still lands here.
 */
export type CategoryRow = Omit<CategoryNode, 'path' | 'depth'>

/** One line of the rendered tree, with everything ARIA needs to describe it. */
export interface VisibleRow {
  readonly row: CategoryRow
  /** 1-based, matching `aria-level` and the contract's own `depth`. */
  readonly level: number
  readonly childCount: number
  readonly hasChildren: boolean
  readonly expanded: boolean
  /** 1-based position among its siblings, for `aria-posinset`. */
  readonly position: number
  readonly siblingCount: number
}

/** Flattens the nested answer into rows, dropping the derived fields. */
export function toRows(nodes: readonly CategoryTreeNode[]): CategoryRow[] {
  return nodes.flatMap(({ children, path: _path, depth: _depth, ...row }) => [
    row,
    ...toRows(children),
  ])
}

/** Live children of `parentId`, in display order. Ties break by id, as the API does. */
export function childrenOf(
  rows: readonly CategoryRow[],
  parentId: number | null,
): readonly CategoryRow[] {
  return rows
    .filter((row) => row.parentId === parentId)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id)
}

export function rowById(rows: readonly CategoryRow[], id: number): CategoryRow | undefined {
  return rows.find((row) => row.id === id)
}

/** 1 for a root, matching the contract's `depth`. 0 when the id is unknown. */
export function levelOf(rows: readonly CategoryRow[], id: number): number {
  const row = rowById(rows, id)
  if (row === undefined) return 0

  return row.parentId === null ? 1 : levelOf(rows, row.parentId) + 1
}

/** Levels occupied by this node and everything under it — 1 for a leaf. */
export function subtreeHeight(rows: readonly CategoryRow[], id: number): number {
  const children = childrenOf(rows, id)

  return children.length === 0
    ? 1
    : 1 + Math.max(...children.map((child) => subtreeHeight(rows, child.id)))
}

/**
 * The rows to draw, in the order they appear, with collapsed subtrees skipped.
 *
 * The order is what the arrow keys walk, so it is computed once and shared: a
 * tree whose keyboard order came from a second traversal would drift from the
 * one on screen the first time either changed.
 */
export function visibleRows(
  rows: readonly CategoryRow[],
  expanded: ReadonlySet<number>,
  parentId: number | null = null,
  level = 1,
): VisibleRow[] {
  const siblings = childrenOf(rows, parentId)

  return siblings.flatMap((row, index) => {
    const children = childrenOf(rows, row.id)
    const isExpanded = expanded.has(row.id)

    const self: VisibleRow = {
      row,
      level,
      childCount: children.length,
      hasChildren: children.length > 0,
      expanded: children.length > 0 && isExpanded,
      position: index + 1,
      siblingCount: siblings.length,
    }

    return self.expanded ? [self, ...visibleRows(rows, expanded, row.id, level + 1)] : [self]
  })
}

/** Ids of every node that has at least one child — the fully expanded state. */
export function branchIds(rows: readonly CategoryRow[]): number[] {
  return rows.filter((row) => rows.some((other) => other.parentId === row.id)).map((row) => row.id)
}

export const MOVE_DIRECTIONS = ['up', 'down', 'out', 'in'] as const

export type MoveDirection = (typeof MOVE_DIRECTIONS)[number]

/**
 * The request one keystroke turns into.
 *
 * Two kinds, because the contract has two endpoints and they mean different
 * things: changing the order of siblings sends the **whole** arrangement
 * (`reorder`), and changing a node's parent sends the node (`move`). Deciding
 * which one a direction needs is arithmetic over the current tree, so it lives
 * here — pure, and checked to the branch (QUALITY-GATES Q5 순수 로직).
 */
export type MovePlan =
  | { readonly kind: 'reorder'; readonly parentId: number | null; readonly orderedIds: number[] }
  | { readonly kind: 'move'; readonly id: number; readonly parentId: number | null }

/**
 * What moving `id` in `direction` would ask the API to do, or `null` when the
 * move is impossible — the node is already first, already a root, has no
 * previous sibling to become a child of, or would push its own subtree past the
 * depth cap.
 *
 * `null` is also what disables the button, so an impossible move cannot be
 * requested and then refused; the two answers come from one function.
 */
export function planMove(
  rows: readonly CategoryRow[],
  id: number,
  direction: MoveDirection,
): MovePlan | null {
  const row = rowById(rows, id)
  if (row === undefined) return null

  const siblings = childrenOf(rows, row.parentId)
  const index = siblings.findIndex((sibling) => sibling.id === id)
  if (index === -1) return null

  switch (direction) {
    case 'up':
    case 'down': {
      const target = direction === 'up' ? index - 1 : index + 1
      if (target < 0 || target >= siblings.length) return null

      const orderedIds = siblings.map((sibling) => sibling.id)
      const [moved] = orderedIds.splice(index, 1)
      if (moved === undefined) return null

      orderedIds.splice(target, 0, moved)

      return { kind: 'reorder', parentId: row.parentId, orderedIds }
    }

    case 'out': {
      if (row.parentId === null) return null
      const parent = rowById(rows, row.parentId)

      // Out is always shallower, so the depth cap cannot be the objection.
      return { kind: 'move', id, parentId: parent?.parentId ?? null }
    }

    case 'in': {
      const previous = siblings[index - 1]
      if (previous === undefined) return null

      // The node lands one level below its previous sibling, carrying its own
      // subtree with it. Three levels is the cap the database also enforces.
      if (levelOf(rows, previous.id) + subtreeHeight(rows, id) > CATEGORY_MAX_DEPTH) return null

      return { kind: 'move', id, parentId: previous.id }
    }
  }
}

/** One past the last sibling — where the API puts a node whose `sortOrder` is omitted. */
function nextSortOrder(rows: readonly CategoryRow[], parentId: number | null): number {
  return childrenOf(rows, parentId).reduce((next, row) => Math.max(next, row.sortOrder + 1), 0)
}

/**
 * The tree as it will look once the API agrees, drawn before it answers.
 *
 * Only `parentId` and `sortOrder` are written — see {@link CategoryRow}. The
 * result is exactly what the endpoint the plan names would produce, which is
 * what makes the optimistic frame and the confirmed one identical rather than
 * merely similar.
 */
export function applyPlan(rows: readonly CategoryRow[], plan: MovePlan): CategoryRow[] {
  if (plan.kind === 'reorder') {
    return rows.map((row) => {
      const position = plan.orderedIds.indexOf(row.id)

      return position === -1 || row.parentId !== plan.parentId
        ? row
        : { ...row, sortOrder: position }
    })
  }

  const sortOrder = nextSortOrder(rows, plan.parentId)

  return rows.map((row) =>
    row.id === plan.id ? { ...row, parentId: plan.parentId, sortOrder } : row,
  )
}

/** Replaces rows the API answered with, leaving the rest untouched. */
export function mergeRows(
  rows: readonly CategoryRow[],
  updated: readonly CategoryRow[],
): CategoryRow[] {
  return rows.map((row) => updated.find((candidate) => candidate.id === row.id) ?? row)
}

/** A category with children cannot be deleted — only retired (TASK-0029 4장). */
export function hasChildren(rows: readonly CategoryRow[], id: number): boolean {
  return rows.some((row) => row.parentId === id)
}

/** Whether a child may still be added under `id` without breaking the cap. */
export function canAddChild(rows: readonly CategoryRow[], id: number): boolean {
  return levelOf(rows, id) < CATEGORY_MAX_DEPTH
}
