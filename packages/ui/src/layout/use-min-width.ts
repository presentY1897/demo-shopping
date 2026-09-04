'use client'

/**
 * Whether the window is at least this wide, as React state.
 *
 * The generic form of what `useViewportBand` does for the density matrix. It
 * exists because **not every layout decision happens at a density band.** The
 * console sidebar turns into a drawer at 1024px (TASK-0019 4.2) — a width the
 * density matrix has no opinion about, because the console has no density
 * (D-033). Reaching for `useViewportBand` there would have meant either moving
 * the console's breakpoint to a number chosen for a product grid, or writing a
 * second copy of this `matchMedia` plumbing.
 *
 * D-055 is what makes a hook necessary at all: a mobile-only pattern is a
 * *different component*, mounted on its own, not two trees with one hidden by
 * CSS. A component asks this and renders one thing.
 *
 * `change` rather than a resize listener — the browser fires it only when the
 * answer actually flips, so dragging a window across 900px re-renders nothing.
 */

import { useSyncExternalStore } from 'react'

/** jsdom without the polyfill, and any server render, land here. */
function unavailable(): boolean {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
}

/**
 * Built from the number rather than written out, so no CSS length literal
 * appears in this file — `test/component-tokens.spec.ts` would reject one, and
 * the breakpoint belongs to the caller either way.
 */
function queryFor(minWidth: number): string {
  return `(min-width: ${String(minWidth)}px)`
}

/**
 * @param minWidth  Lower bound, in CSS pixels.
 * @param serverSnapshot  What the server — which cannot know the window — should
 *   answer. `false` is the mobile-first guess and the right one even for the
 *   desktop-first console: guessing `true` there would paint a fixed sidebar
 *   over a phone's content for the frame before hydration. What that guess
 *   normally costs — the desktop layout arriving late and shifting the page —
 *   is removed structurally instead (TASK-0019 4.3).
 */
export function useMinWidth(minWidth: number, serverSnapshot = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (unavailable()) return () => undefined

      const list = window.matchMedia(queryFor(minWidth))
      list.addEventListener('change', onChange)

      return () => {
        list.removeEventListener('change', onChange)
      }
    },
    () => (unavailable() ? serverSnapshot : window.matchMedia(queryFor(minWidth)).matches),
    () => serverSnapshot,
  )
}
