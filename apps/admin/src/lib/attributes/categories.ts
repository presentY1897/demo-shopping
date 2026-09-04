import type { CategoryRow } from '@/lib/categories/tree'
import { childrenOf } from '@/lib/categories/tree'

/**
 * One category as the attribute console's picker offers it.
 *
 * `path` is the names from the root down, not a rendered string: the separator
 * and the retired suffix are copy, and copy belongs to the catalog. What this
 * module owns is the *order* and the *ancestry*, which is the part a test can
 * be precise about.
 */
export interface CategoryChoice {
  readonly id: number
  readonly path: readonly string[]
  readonly isActive: boolean
}

/**
 * Every category, depth first, each carrying the names above it.
 *
 * **The tree is reused, not re-derived.** `childrenOf` is TASK-0029's, so the
 * order the picker offers is the order the category console shows, down to how
 * ties in `sortOrder` break. A second traversal here would be a second answer to
 * "what order are categories in".
 *
 * Retired categories stay in the list. Definitions attached to one are still
 * live and still inherited by everything under it; a picker that hid them would
 * make those definitions uneditable and invisible at once — the same reason the
 * category console asks for `includeInactive` (TASK-0031 4.1).
 */
export function categoryChoices(
  rows: readonly CategoryRow[],
  parentId: number | null = null,
  ancestors: readonly string[] = [],
): readonly CategoryChoice[] {
  return childrenOf(rows, parentId).flatMap((row) => {
    const path = [...ancestors, row.name]

    return [{ id: row.id, path, isActive: row.isActive }, ...categoryChoices(rows, row.id, path)]
  })
}

/** The choice with this id, or `undefined` when it is not in the tree. */
export function choiceById(
  choices: readonly CategoryChoice[],
  id: number | null,
): CategoryChoice | undefined {
  return id === null ? undefined : choices.find((choice) => choice.id === id)
}

/** The name a category is known by — the last segment of its path. */
export function choiceName(choice: CategoryChoice): string {
  return choice.path[choice.path.length - 1] ?? ''
}
