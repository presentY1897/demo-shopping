import type { CategoryTreeNode } from '@shopping/shared'

/**
 * Reading the storefront's category tree (TASK-0042).
 *
 * Pure, and separate from anything that fetches: the page needs the same three
 * answers on the server (for the metadata and the breadcrumb) and in the browser
 * (for the header's menu), and a lookup that lived inside a hook could only be
 * had in one of those places.
 *
 * The tree arrives already pruned — `GET /categories/tree` returns active nodes
 * only and drops the subtree under a retired one — so nothing here filters. A
 * node that is in this tree is a node a shopper may reach.
 */

/** Every node, parents before children. */
export function flattenCategories(nodes: readonly CategoryTreeNode[]): readonly CategoryTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenCategories(node.children)])
}

export function findCategoryBySlug(
  nodes: readonly CategoryTreeNode[],
  slug: string,
): CategoryTreeNode | null {
  return flattenCategories(nodes).find((node) => node.slug === slug) ?? null
}

/**
 * The lineage from the root down to and including this node.
 *
 * Read from `path` rather than by walking `parentId` upwards: the path is the
 * materialised `/1/5/12/` the database maintains and verifies, so a breadcrumb
 * built from it cannot disagree with the tree — and the walk is one pass instead
 * of one lookup per level.
 */
export function categoryLineage(
  nodes: readonly CategoryTreeNode[],
  node: CategoryTreeNode,
): readonly CategoryTreeNode[] {
  const ids = node.path.split('/').filter((part) => part !== '')
  const byId = new Map(flattenCategories(nodes).map((entry) => [String(entry.id), entry]))

  return ids.flatMap((id) => {
    const found = byId.get(id)

    return found === undefined ? [] : [found]
  })
}

/**
 * What the header offers: roots and their children, and no deeper (R1).
 *
 * 40 categories over three levels is a menu nobody reads. The third level is
 * reachable from the category page itself, where there is room to list it and a
 * heading to say what it belongs to.
 */
export interface CategoryMenuEntry {
  readonly node: CategoryTreeNode
  readonly children: readonly CategoryTreeNode[]
}

export function categoryMenu(nodes: readonly CategoryTreeNode[]): readonly CategoryMenuEntry[] {
  return nodes.map((node) => ({ node, children: node.children }))
}
