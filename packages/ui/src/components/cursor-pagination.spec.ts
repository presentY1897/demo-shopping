/**
 * The cursor history, as input → output.
 *
 * Every branch is here: the empty history a caller can construct, the duplicate
 * push, the pop at the start of the list. These are the cases that turn into
 * "이전 needs two presses" or "the list jumps two pages" in a screen, and none
 * of them need a DOM to reproduce.
 */

import { describe, expect, it } from 'vitest'

import {
  currentCursor,
  hasPreviousPage,
  INITIAL_CURSOR_HISTORY,
  pageIndex,
  popCursor,
  pushCursor,
} from './cursor-pagination'

describe('currentCursor', () => {
  it('is null on the first page', () => {
    expect(currentCursor(INITIAL_CURSOR_HISTORY)).toBeNull()
  })

  it('is the cursor most recently moved onto', () => {
    expect(currentCursor([null, 'a', 'b'])).toBe('b')
  })

  it('treats an empty history as the first page', () => {
    // Reachable when a history is restored from a URL or a session.
    expect(currentCursor([])).toBeNull()
  })
})

describe('hasPreviousPage', () => {
  it('is false on the first page', () => {
    expect(hasPreviousPage(INITIAL_CURSOR_HISTORY)).toBe(false)
    expect(hasPreviousPage([])).toBe(false)
  })

  it('is true once a page has been visited', () => {
    expect(hasPreviousPage([null, 'a'])).toBe(true)
  })
})

describe('pageIndex', () => {
  it('counts from zero', () => {
    expect(pageIndex(INITIAL_CURSOR_HISTORY)).toBe(0)
    expect(pageIndex([null, 'a', 'b'])).toBe(2)
    expect(pageIndex([])).toBe(0)
  })
})

describe('pushCursor', () => {
  it('appends the cursor and leaves the original untouched', () => {
    const history = INITIAL_CURSOR_HISTORY
    const next = pushCursor(history, 'a')

    expect(next).toEqual([null, 'a'])
    expect(history).toEqual([null])
  })

  it('ignores a repeat of the cursor already on top', () => {
    // A double click on 다음 resolves against the same response twice. Appending
    // would insert a page nobody saw, and 이전 would then take two presses.
    const history = pushCursor(INITIAL_CURSOR_HISTORY, 'a')

    expect(pushCursor(history, 'a')).toBe(history)
  })

  it('accepts a cursor equal to an earlier one', () => {
    // Only the top is de-duplicated: a keyset scan can legitimately hand back a
    // cursor seen before if the caller went back and forward again.
    expect(pushCursor([null, 'a', 'b'], 'a')).toEqual([null, 'a', 'b', 'a'])
  })
})

describe('popCursor', () => {
  it('goes back exactly one page', () => {
    expect(popCursor([null, 'a', 'b'])).toEqual([null, 'a'])
  })

  it('does nothing on the first page', () => {
    const history = INITIAL_CURSOR_HISTORY

    expect(popCursor(history)).toBe(history)
    expect(popCursor([])).toEqual([])
  })
})
