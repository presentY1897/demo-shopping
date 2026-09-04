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
 * second breakpoint list would be a second place to get them wrong. A layout
 * that turns at some *other* width — the console sidebar at 1024 — asks
 * `useMinWidth` directly instead of bending a band to fit.
 *
 * The server snapshot is `base`. The server does not know how wide this
 * visitor's window is, `apps/shop` is mobile first (DECISIONS 1장), and the
 * narrow layout is therefore the safe guess — a desktop visitor gets the mobile
 * header for the moment between paint and hydration. That is only acceptable
 * because the two forms are built to the same height: the swap must not move
 * anything below it (TASK-0018 4.4).
 */

import { DENSITY_VIEWPORT_MIN_WIDTH, type DensityViewport } from '../density/density'
import { useMinWidth } from './use-min-width'

export function useViewportBand(): DensityViewport {
  // Two subscriptions rather than one, which is what reading the boundaries
  // through the shared hook costs. `change` fires only when a boundary is
  // actually crossed, so the cost is two listeners and no extra renders.
  const md = useMinWidth(DENSITY_VIEWPORT_MIN_WIDTH.md)
  const xl = useMinWidth(DENSITY_VIEWPORT_MIN_WIDTH.xl)

  if (xl) return 'xl'
  if (md) return 'md'
  return 'base'
}
