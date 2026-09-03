'use client'

/**
 * React state for cursor pagination.
 *
 * Everything interesting is in `cursor-pagination.ts`, which is pure and
 * therefore testable as input → output. This is the twenty lines that hold the
 * history in a `useState` — kept apart so that "does 이전 go back exactly one
 * page" is answered by a unit test rather than by rendering something.
 */

import { useCallback, useMemo, useState } from 'react'

import {
  currentCursor,
  hasPreviousPage,
  INITIAL_CURSOR_HISTORY,
  pageIndex,
  popCursor,
  pushCursor,
  type CursorHistory,
} from './cursor-pagination'

export interface UseCursorPaginationOptions {
  /**
   * The cursor the *current* response says leads to the next page, or `null` at
   * the end of the list. This is the only thing the server has to return.
   */
  readonly nextCursor: string | null
  /** Called with the cursor to fetch whenever the page changes. */
  readonly onCursorChange?: (cursor: string | null) => void
}

export interface CursorPagination {
  /** Feed this to the query for the page being shown; `null` is the first page. */
  readonly cursor: string | null
  readonly pageIndex: number
  readonly hasPrevious: boolean
  readonly hasNext: boolean
  readonly goNext: () => void
  readonly goPrevious: () => void
  /** Back to the first page — after a filter or a sort change. */
  readonly reset: () => void
}

export function useCursorPagination({
  nextCursor,
  onCursorChange,
}: UseCursorPaginationOptions): CursorPagination {
  const [history, setHistory] = useState<CursorHistory>(INITIAL_CURSOR_HISTORY)

  /**
   * The three moves all read `history` from the closure rather than from a
   * functional `setState` updater. An updater must be pure — React calls it
   * twice in StrictMode — so notifying the caller from inside one would fire the
   * refetch twice per click on every development build.
   */
  const goNext = useCallback(() => {
    // Guarded rather than trusted: the button is disabled at the end of the
    // list, but a keyboard repeat or a stale render can still get here, and
    // pushing `null` would put an unreachable page in the history.
    if (nextCursor === null) return
    const next = pushCursor(history, nextCursor)
    if (next === history) return
    setHistory(next)
    onCursorChange?.(currentCursor(next))
  }, [history, nextCursor, onCursorChange])

  const goPrevious = useCallback(() => {
    const next = popCursor(history)
    if (next === history) return
    setHistory(next)
    onCursorChange?.(currentCursor(next))
  }, [history, onCursorChange])

  const reset = useCallback(() => {
    if (history === INITIAL_CURSOR_HISTORY) return
    setHistory(INITIAL_CURSOR_HISTORY)
    onCursorChange?.(null)
  }, [history, onCursorChange])

  return useMemo(
    () => ({
      cursor: currentCursor(history),
      goNext,
      goPrevious,
      hasNext: nextCursor !== null,
      hasPrevious: hasPreviousPage(history),
      pageIndex: pageIndex(history),
      reset,
    }),
    [history, nextCursor, goNext, goPrevious, reset],
  )
}
