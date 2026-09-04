import type { SellerStockFilter } from '@shopping/shared'
import { LOW_STOCK_THRESHOLD } from '@shopping/shared'

/**
 * The console list's decisions, as pure functions (TASK-0115 4장).
 *
 * Three questions live here and none of them needs a database.
 *
 * **Which band is this listing in?** 품절, 품절 임박, or neither. The bands do
 * not overlap, which is the whole point: TASK-0035 left the threshold undecided
 * and the approved plan then wrote the filter as "가용재고 ≤ 5" — under which a
 * sold-out listing matches 품절 *and* 품절 임박, and the screen has to pick one.
 * That choice is a second rule, in a second place, and it is exactly what
 * sharing a constant was supposed to prevent.
 *
 * **Which band does a filter name?** The same three, expressed as bounds a
 * `WHERE` clause can use. Filtering has to happen in SQL — a page of twenty
 * cannot be selected by discarding rows in TypeScript — so the boundary exists
 * twice by necessity: once as a comparison the database makes, once as the flag
 * the row carries. {@link stockBandOf} and {@link stockBoundsOf} are both here
 * so that a spec can hold them against each other over the whole range, which
 * is the only way that duplication stays honest.
 *
 * **What does a name search match?** A substring, with the pattern's own
 * metacharacters neutralised — a seller typing `50%` is looking for a product
 * with `50%` in its name, not for every product they have.
 *
 * No I/O, so every branch is reachable from a unit test and the gate on this
 * file is branch coverage 100% (QUALITY-GATES Q5 — 순수 로직).
 */

/**
 * How much stock a listing has, judged rather than counted.
 *
 * `out` is exactly zero. `low` starts at one, so the two are disjoint and a
 * listing is only ever one of them.
 */
export type StockBand = 'out' | 'low' | 'ok'

/**
 * The band a total falls in.
 *
 * "가용재고" in the design document is `stock` minus live reservations, and
 * reservations arrive in M07 — until then the two are the same number, and this
 * function is where that will change (TASK-0115 4장).
 */
export function stockBandOf(totalStock: number): StockBand {
  if (totalStock <= 0) return 'out'

  return totalStock <= LOW_STOCK_THRESHOLD ? 'low' : 'ok'
}

/** Whether a row carries the 품절 임박 badge. Sold out is **not** low. */
export function isLowStock(totalStock: number): boolean {
  return stockBandOf(totalStock) === 'low'
}

/**
 * Inclusive bounds for a `WHERE`, `null` meaning "no bound on this side".
 *
 * Both `null` is "every listing", which is what an absent filter asks for.
 */
export interface StockBounds {
  readonly min: number | null
  readonly max: number | null
}

/** The band a filter selects, as bounds. */
export function stockBoundsOf(filter: SellerStockFilter | undefined): StockBounds {
  if (filter === 'out') return { min: 0, max: 0 }
  if (filter === 'low') return { min: 1, max: LOW_STOCK_THRESHOLD }

  return { min: null, max: null }
}

/**
 * The escape character the search pattern is built with.
 *
 * A backslash, and stated rather than assumed: PostgreSQL's default for `LIKE`
 * is the same character, but leaving it implicit means the pattern and the
 * statement have to agree by coincidence. The query says `ESCAPE '\'`.
 */
export const SEARCH_ESCAPE = '\\'

/**
 * A name search, as an `ILIKE` pattern.
 *
 * `%` and `_` are wildcards and `\` starts an escape, so all three are escaped
 * before the surrounding wildcards go on. Without this, searching for `50%`
 * matches every product whose name starts with `50` — and searching for `_`
 * matches the entire catalogue, which is the version of this bug somebody finds
 * by accident.
 *
 * Answers `null` for a search that is nothing but whitespace: an empty pattern
 * is `%%`, which selects everything, and a filter that silently means "no
 * filter" is worse than one that says so.
 */
export function nameSearchPattern(query: string | undefined): string | null {
  if (query === undefined) return null

  const trimmed = query.trim()

  if (trimmed === '') return null

  const escaped = trimmed.replaceAll(/[\\%_]/gu, (character) => `${SEARCH_ESCAPE}${character}`)

  return `%${escaped}%`
}
