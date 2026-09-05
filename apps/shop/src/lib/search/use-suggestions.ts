'use client'

import { useEffect, useState } from 'react'

import { fetchSearchSuggestions } from './search-api'

/**
 * 자동완성 후보 (TASK-0041 R2: 디바운스 250ms + 최소 2글자).
 *
 * Both numbers are the same defence from two directions. Without the debounce a
 * six-character word is six requests, five of which are already stale when they
 * arrive; without the minimum, one character asks the engine for a prefix that
 * matches most of the catalogue and the answer is useless anyway.
 *
 * **In-flight requests are aborted, not just ignored.** A dropped response would
 * still have cost the round trip, and — worse — two overlapping requests can land
 * out of order, so the list for 「원」 could arrive after the list for 「원피」 and
 * overwrite it. Aborting makes that unrepresentable rather than unlikely.
 *
 * **What is stored is a term *and* its answer**, and the hook returns the answer
 * only while the term still matches what is typed. That is why nothing here
 * clears state: a list belonging to a word that is no longer in the box simply
 * stops being returned, so there is no window — not even one frame during the
 * debounce — in which the dropdown offers candidates for something else.
 */

export const SUGGEST_DEBOUNCE_MS = 250
export const SUGGEST_MIN_LENGTH = 2

const NONE: readonly string[] = []

export function useSuggestions(term: string, enabled = true): readonly string[] {
  const [answered, setAnswered] = useState<{
    readonly term: string
    readonly items: readonly string[]
  }>({ term: '', items: NONE })

  const trimmed = term.trim()
  const active = enabled && trimmed.length >= SUGGEST_MIN_LENGTH

  useEffect(() => {
    if (!active) return

    const controller = new AbortController()
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const answer = await fetchSearchSuggestions(trimmed, { signal: controller.signal })

          if (!controller.signal.aborted) {
            setAnswered({ term: trimmed, items: answer.suggestions })
          }
        } catch {
          // A failed suggest is a suggest that shows nothing. It must never
          // become an error state: the box below it still works, and the person
          // typing has not asked for anything yet.
          if (!controller.signal.aborted) setAnswered({ term: trimmed, items: NONE })
        }
      })()
    }, SUGGEST_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed, active])

  return active && answered.term === trimmed ? answered.items : NONE
}
