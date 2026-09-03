import { CATEGORY_MAX_DEPTH } from '@shopping/shared'

/**
 * The materialised path, as pure functions.
 *
 * A category's `path` is the ids of its ancestors followed by its own, wrapped
 * in slashes: `/1/5/12/`. One `LIKE '/1/5/%'` then returns an entire subtree,
 * which is the whole reason the column exists — the adjacency list alone needs
 * recursion for the same answer (TASK-0028 4장).
 *
 * Nothing here touches a database. The rules a path obeys are stated three
 * times on purpose, and the three are not redundant:
 *
 * - **here**, so a wrong path is a failed unit test rather than a wrong row;
 * - in `CategoryService`, so a request gets a 400 that names the problem;
 * - in the **migration**, so no code path — including one written next year —
 *   can commit a tree that disagrees with itself.
 */

/** `parentPath` of a root: the path of a node one level up from the first. */
export const ROOT_PATH = '/'

/** The path a node with `id` has under a parent whose path is `parentPath`. */
export function pathOf(parentPath: string | null, id: number): string {
  return `${parentPath ?? ROOT_PATH}${String(id)}/`
}

/** How many ids a path holds. `/1/5/12/` is 3. */
export function depthOf(path: string): number {
  let slashes = 0

  for (const character of path) if (character === '/') slashes += 1

  return slashes - 1
}

/**
 * Whether `path` is `ancestorPath` itself or sits underneath it.
 *
 * This is the cycle test. Because a path always ends in its own id and always
 * begins with its parent's path, "is the destination inside the subtree I am
 * moving?" is a prefix comparison and needs no walk up the tree — which is what
 * makes it safe to answer inside a transaction that holds the tree lock.
 */
export function isSelfOrDescendant(path: string, ancestorPath: string): boolean {
  return path.startsWith(ancestorPath)
}

/** Whether a subtree of `height` levels fits under a parent at `parentDepth`. */
export function fitsUnder(parentDepth: number, subtreeHeight: number): boolean {
  return parentDepth + subtreeHeight <= CATEGORY_MAX_DEPTH
}

/** Why a move was refused, or `null` when it is legal. */
export type MoveRefusal = 'cycle' | 'too_deep'

export interface MoveCandidate {
  /** Path of the node being moved. */
  readonly path: string
  /** Its current depth. */
  readonly depth: number
  /** Greatest depth found anywhere in its subtree, itself included. */
  readonly subtreeDepth: number
}

export interface MoveDestination {
  /** Path of the new parent; `null` when moving to the top level. */
  readonly path: string | null
  /** Depth of the new parent; `0` when moving to the top level. */
  readonly depth: number
}

/**
 * The whole decision a move has to make, with no I/O in it.
 *
 * Both refusals are checked against values the caller has already read under
 * the tree lock, so the answer cannot go stale between the check and the write.
 */
export function refuseMove(node: MoveCandidate, destination: MoveDestination): MoveRefusal | null {
  if (destination.path !== null && isSelfOrDescendant(destination.path, node.path)) return 'cycle'

  const height = node.subtreeDepth - node.depth + 1

  return fitsUnder(destination.depth, height) ? null : 'too_deep'
}

/**
 * Rewrites one path so that the subtree rooted at `oldPrefix` now hangs off
 * `newPrefix`.
 *
 * The database does the same rewrite in a single `UPDATE` over the whole
 * subtree; this exists so that the arithmetic can be tested on its own and so
 * that a caller can predict what that statement will produce.
 */
export function rebasePath(path: string, oldPrefix: string, newPrefix: string): string {
  return `${newPrefix}${path.slice(oldPrefix.length)}`
}
