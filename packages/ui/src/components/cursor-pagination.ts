/**
 * Cursor (keyset) pagination — the pure half.
 *
 * `docs/design/pages.md` 공통 규칙 makes cursors the default for every list:
 * an offset gets slower the deeper the page and, worse, **duplicates and drops
 * rows while the list is changing underneath it**. Insert one product and
 * `OFFSET 20` now starts one row earlier, so the row that was last on page 1 is
 * first on page 2. Product and order lists change constantly.
 *
 * A cursor names a *position* — "everything after this row" — so an insertion
 * before it changes nothing about the page after it. The cost is that the
 * server can only hand out the *next* cursor, so "back" is not something the
 * client can compute. It has to be remembered, and remembering it is all this
 * module does: a stack of the cursors already visited, oldest first, with the
 * first page represented by `null`.
 *
 * No React here on purpose. The whole of the "did we skip or repeat a row"
 * question is decided by these four functions, and they are testable as
 * input → output (QUALITY-GATES: 순수 로직 분기 커버리지 100%).
 */

/**
 * Cursors visited so far, oldest first.
 *
 * Always at least one entry: `null`, the first page, which no server response
 * can produce and which therefore has to be seeded.
 */
export type CursorHistory = readonly (string | null)[]

/** A fresh history, sitting on the first page. */
export const INITIAL_CURSOR_HISTORY: CursorHistory = [null]

/**
 * The shape a paginated response has to expose for this to work.
 *
 * `nextCursor: null` is how the server says "this is the last page"; an empty
 * `items` with a non-null cursor is legal and means "nothing matched in this
 * window, keep going", which is what a filtered keyset scan does.
 */
export interface CursorPage<Item> {
  readonly items: readonly Item[]
  readonly nextCursor: string | null
}

/** The cursor for the page currently being shown. */
export function currentCursor(history: CursorHistory): string | null {
  // A history is never empty, but a caller can hand one in from anywhere —
  // a URL, a restored session — so an empty array resolves to the first page
  // rather than to `undefined` leaking out as a cursor.
  return history.length === 0 ? null : (history[history.length - 1] ?? null)
}

/** Whether there is a page to go back to. */
export function hasPreviousPage(history: CursorHistory): boolean {
  return history.length > 1
}

/** Zero-based index of the page being shown. */
export function pageIndex(history: CursorHistory): number {
  return Math.max(0, history.length - 1)
}

/**
 * Moves forward onto `cursor`.
 *
 * Pushing the cursor that is already on top is refused rather than merged: it
 * means the caller advanced twice on one response — a double click on 다음, or a
 * request that resolved twice — and appending it would put a page in the history
 * that the reader never saw, so 이전 would then need two presses to go back one
 * page.
 */
export function pushCursor(history: CursorHistory, cursor: string): CursorHistory {
  return currentCursor(history) === cursor ? history : [...history, cursor]
}

/** Moves back one page. On the first page there is nothing to pop. */
export function popCursor(history: CursorHistory): CursorHistory {
  return hasPreviousPage(history) ? history.slice(0, -1) : history
}
