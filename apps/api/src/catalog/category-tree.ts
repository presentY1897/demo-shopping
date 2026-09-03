import type { CategoryNode, CategoryTreeNode } from '@shopping/shared'

/**
 * Turning the one flat result set into the nested answer.
 *
 * The read is a single query — `path LIKE '/1/5/%'` — so the shape has to be
 * rebuilt in memory. Doing it here, over plain values, is what lets gate A5
 * (no N+1) be a property of the design rather than a promise: there is no place
 * in this file that could go back to the database for a child.
 */

/**
 * Assembles `rows` into a forest.
 *
 * `rows` must arrive **shallowest first** — the caller orders by `depth`, then
 * by `sortOrder`, then by `id` — so every parent is already in the index by the
 * time its children are seen, and the children of one parent keep the order the
 * database returned them in.
 *
 * A node whose parent is missing from `rows` is **dropped together with its own
 * descendants**, which is exactly what hiding an inactive branch has to mean: a
 * child of a hidden category must not resurface at the top level. The single
 * exception is `rootId`, whose parent is deliberately outside the result.
 */
export function buildCategoryForest(
  rows: readonly CategoryNode[],
  rootId?: number,
): CategoryTreeNode[] {
  const children = new Map<number, CategoryTreeNode[]>()
  const forest: CategoryTreeNode[] = []

  for (const row of rows) {
    const node: CategoryTreeNode = { ...row, children: [] }
    const siblings = node.children as CategoryTreeNode[]

    children.set(node.id, siblings)

    if (rootId === undefined ? node.parentId === null : node.id === rootId) {
      forest.push(node)
      continue
    }

    // `parentId === null` here means a root that was not the one asked for.
    const parent = node.parentId === null ? undefined : children.get(node.parentId)

    // Missing parent: the branch above this node was filtered out, so this node
    // is not part of the answer either. Its own children then find nothing
    // under `children` and disappear for the same reason.
    if (parent !== undefined) parent.push(node)
    else children.delete(node.id)
  }

  return forest
}

/** Every node of a forest, parents before children. */
export function flattenCategoryForest(
  forest: readonly CategoryTreeNode[],
): readonly CategoryTreeNode[] {
  return forest.flatMap((node) => [node, ...flattenCategoryForest(node.children)])
}
