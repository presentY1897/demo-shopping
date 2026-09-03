/**
 * Which attribute definitions apply to a category — as pure functions.
 *
 * "상위 카테고리에서 상속" (DECISIONS 3) is one sentence and two rules, and the
 * second one is the one that is easy to miss:
 *
 * 1. a category's effective attributes are its own **plus every ancestor's**;
 * 2. when the same `key` appears twice in a lineage, the **nearest** definition
 *    wins.
 *
 * Rule 2 exists because this function has to be **total**. `AttributeService`
 * refuses to create a definition whose key already exists anywhere in the
 * lineage, so a duplicate should be impossible — but a category *move* creates
 * one without asking: two roots that each define `brand` become one lineage the
 * moment a subtree is dragged from one to the other, and the move is TASK-0028's
 * code, which knows nothing about attributes. A resolver that threw on the
 * impossible would take the whole admin console down with one drag
 * (TASK-0030 4.1).
 *
 * No I/O here, on purpose: rows and a lineage come in, an answer comes out, so
 * the gate on this file is branch coverage 100% (QUALITY-GATES Q5 — 순수 로직).
 */

/**
 * The ids in a materialised path, roots first: `/1/5/12/` is `[1, 5, 12]`.
 *
 * `Category.path` always begins and ends with a slash, so the split produces an
 * empty segment at each end; dropping the empties is what makes the same
 * function work for a root (`/1/`) and a leaf.
 *
 * The index of an id in the result is its depth minus one, which is the whole
 * reason this is worth having: "how far from the target is this definition?" —
 * the question rule 2 turns on — becomes an array lookup instead of another
 * query.
 */
export function ancestorIdsOf(path: string): readonly number[] {
  return path
    .split('/')
    .filter((segment) => segment !== '')
    .map(Number)
}

/** What resolution needs from a definition row; the rest is carried through. */
export interface OwnedAttribute {
  readonly id: number
  readonly categoryId: number
  readonly key: string
  readonly sortOrder: number
}

/** A definition together with where it came from, relative to the target. */
export type Inherited<T> = T & { readonly inherited: boolean }

/** One candidate, with the lineage position that decides whether it wins. */
interface Ranked<T> {
  readonly row: T
  /** 0 for the root of the lineage, `lineage.length - 1` for the target itself. */
  readonly level: number
}

/**
 * Whether `candidate` beats `held` for the same key.
 *
 * Deeper wins — that is rule 2. The two tie-breakers below it only matter for a
 * lineage that already disagrees with itself (two definitions of one key on one
 * category, which the partial unique index forbids); they are here so that the
 * answer is a **function of the rows** rather than of the order the database
 * happened to return them.
 */
function beats<T extends OwnedAttribute>(candidate: Ranked<T>, held: Ranked<T>): boolean {
  if (candidate.level !== held.level) return candidate.level > held.level
  if (candidate.row.sortOrder !== held.row.sortOrder) {
    return candidate.row.sortOrder < held.row.sortOrder
  }

  return candidate.row.id < held.row.id
}

/** Display order: general first, then the owner's arrangement, then by id. */
function compare<T extends OwnedAttribute>(left: Ranked<T>, right: Ranked<T>): number {
  if (left.level !== right.level) return left.level - right.level
  if (left.row.sortOrder !== right.row.sortOrder) return left.row.sortOrder - right.row.sortOrder

  return left.row.id - right.row.id
}

/**
 * The definitions that apply to the category at the end of `lineage`.
 *
 * `rows` are every live definition owned by any category in the lineage, in any
 * order — the query fetches them in one statement, so ordering there would only
 * be a claim this function then has to trust. A row owned by a category outside
 * the lineage is dropped rather than trusted: it can only come from a caller
 * that passed the wrong lineage, and silently including it would attach an
 * attribute to a category that never inherited it.
 *
 * The answer is ordered general-to-specific, so a form built straight from it
 * asks for 브랜드 before 소재 without the caller sorting anything.
 */
export function resolveEffectiveAttributes<T extends OwnedAttribute>(
  rows: readonly T[],
  lineage: readonly number[],
): readonly Inherited<T>[] {
  const levels = new Map(lineage.map((categoryId, level) => [categoryId, level]))
  const winners = new Map<string, Ranked<T>>()

  for (const row of rows) {
    const level = levels.get(row.categoryId)

    if (level === undefined) continue

    const candidate: Ranked<T> = { row, level }
    const held = winners.get(row.key)

    if (held === undefined || beats(candidate, held)) winners.set(row.key, candidate)
  }

  const own = lineage.length - 1

  return [...winners.values()]
    .sort(compare)
    .map(({ row, level }) => ({ ...row, inherited: level < own }))
}
