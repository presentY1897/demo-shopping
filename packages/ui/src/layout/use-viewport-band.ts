'use client'

/**
 * Which of the three viewport bands the window is in, as React state.
 *
 * D-055 is explicit that a mobile-only pattern — a hamburger where the desktop
 * has a nav, a bottom sheet where it has a side panel — is a *different
 * component*, mounted on its own, and not two trees with one of them hidden by
 * CSS. Hiding both doubles the DOM and leaves a duplicate accessibility tree
 * that only a screen reader ever notices. This hook is what that rule needs to
 * be followed: a component asks which band it is in and renders one thing.
 *
 * **The bands are the density bands.** `DENSITY_VIEWPORT_MIN_WIDTH` already
 * carries 768 and 1280 because the density matrix is two-dimensional, and a
 * second breakpoint list would be a second place to get them wrong.
 *
 * The server snapshot is `base`. The server does not know how wide this
 * visitor's window is, `apps/shop` is mobile first (DECISIONS 1장), and the
 * narrow layout is therefore the safe guess — a desktop visitor gets the mobile
 * header for the moment between paint and hydration. That is only acceptable
 * because the two forms are built to the same height: the swap must not move
 * anything below it (TASK-0018 4.4).
 */

import { useSyncExternalStore } from 'react'

import { DENSITY_VIEWPORT_MIN_WIDTH, type DensityViewport } from '../density/density'

/**
 * Built from the numbers rather than written out, so the breakpoint exists in
 * exactly one place — and so this file contains no CSS length literal, which
 * `test/component-tokens.spec.ts` would reject.
 */
const QUERIES = {
  md: `(min-width: ${String(DENSITY_VIEWPORT_MIN_WIDTH.md)}px)`,
  xl: `(min-width: ${String(DENSITY_VIEWPORT_MIN_WIDTH.xl)}px)`,
} as const

/** jsdom without the polyfill, and any server render, land here. */
function unavailable(): boolean {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
}

function matches(query: string): boolean {
  return window.matchMedia(query).matches
}

/**
 * One subscription per band boundary. `change` rather than a resize listener:
 * the browser fires it only when the answer actually flips, so dragging a window
 * across 900px does not re-render anything.
 */
function subscribe(onChange: () => void): () => void {
  if (unavailable()) return () => undefined

  const lists = [window.matchMedia(QUERIES.md), window.matchMedia(QUERIES.xl)]
  for (const list of lists) list.addEventListener('change', onChange)

  return () => {
    for (const list of lists) list.removeEventListener('change', onChange)
  }
}

/**
 * A string, so `useSyncExternalStore`'s "unchanged between renders" requirement
 * is satisfied by value and there is no cached object to go stale.
 */
function getSnapshot(): DensityViewport {
  if (unavailable()) return 'base'
  if (matches(QUERIES.xl)) return 'xl'
  if (matches(QUERIES.md)) return 'md'
  return 'base'
}

function getServerSnapshot(): DensityViewport {
  return 'base'
}

export function useViewportBand(): DensityViewport {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
