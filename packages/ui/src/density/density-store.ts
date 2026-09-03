/**
 * The density choice as an external store.
 *
 * The value lives in two places the React tree does not own — the `data-density`
 * attribute on `<html>` (what the CSS reads) and localStorage (what survives a
 * reload) — so it is modelled as an external store and read through
 * `useSyncExternalStore` rather than as component state. That is what lets the
 * boot script decide the first paint while React still hydrates the markup the
 * server sent, without a mismatch and without a flash of the wrong density.
 *
 * No React import: this module is exercised directly by its own tests, and the
 * hook in `density-context.tsx` is a thin wrapper over it.
 */

import {
  DEFAULT_DENSITY,
  DENSITY_ATTRIBUTE,
  DENSITY_STORAGE_KEY,
  parseDensityLevel,
  type DensityLevel,
} from './density'

type Listener = () => void

const listeners = new Set<Listener>()

/**
 * Every localStorage access is guarded. Reading it throws outright in Safari's
 * private mode and wherever site data is blocked, and a display preference is
 * not worth taking the page down for.
 */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function readStoredDensity(): DensityLevel | null {
  try {
    return parseDensityLevel(storage()?.getItem(DENSITY_STORAGE_KEY))
  } catch {
    return null
  }
}

export function writeStoredDensity(level: DensityLevel): void {
  try {
    storage()?.setItem(DENSITY_STORAGE_KEY, String(level))
  } catch {
    // A visitor who blocks site data still gets the density they picked for
    // this page view; it just does not survive the reload.
  }
}

/** Puts the value where the stylesheet can see it. */
export function applyDensityAttribute(level: DensityLevel): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute(DENSITY_ATTRIBUTE, String(level))
}

/**
 * The current value, read fresh every time.
 *
 * `useSyncExternalStore` requires a snapshot that is stable between renders when
 * nothing changed; a number satisfies that by value, so there is no cache here
 * to invalidate — and therefore no way for the cache and the DOM to disagree.
 *
 * The attribute wins over localStorage because the boot script has already
 * reconciled the two, and because a nested override (a preview panel rendering
 * one step while the page runs another) is legitimate.
 */
export function getDensitySnapshot(): DensityLevel {
  if (typeof document !== 'undefined') {
    const applied = parseDensityLevel(document.documentElement.getAttribute(DENSITY_ATTRIBUTE))
    if (applied !== null) return applied
  }
  return readStoredDensity() ?? DEFAULT_DENSITY
}

export function subscribeToDensity(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Applies, persists and publishes — in that order, so a listener never reads a stale attribute. */
export function setDensity(level: DensityLevel): void {
  applyDensityAttribute(level)
  writeStoredDensity(level)
  for (const listener of listeners) listener()
}
