/**
 * Whether the first-visit nudge towards the density toggle is still owed.
 *
 * TASK-0018 R1: the toggle is the point of difference of this storefront and a
 * visitor who never notices it never sees the feature. The nudge is shown once —
 * to someone who has never chosen a step — and never again after it is
 * dismissed or a step is picked.
 *
 * Two keys rather than one, and neither is a component's state: the choice
 * itself belongs to `@shopping/ui/density` (it is what the boot script reads
 * before first paint), and this only records that the *explanation* has been
 * seen. Merging them would mean writing a density the visitor never asked for.
 *
 * Every access is wrapped: reading localStorage throws outright in Safari's
 * private mode and wherever site data is blocked, and a hint is not worth taking
 * a storefront down for.
 */

import { readStoredDensity } from '@shopping/ui/density'

export const DENSITY_HINT_KEY = 'shopping.shop.density.hint'

/** The value written; only its presence is read. */
const SEEN = 'seen'

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function densityHintDismissed(): boolean {
  try {
    return storage()?.getItem(DENSITY_HINT_KEY) === SEEN
  } catch {
    // Unreadable storage means an unknowable answer; treat it as dismissed so a
    // visitor who cannot be remembered is not nagged on every page load.
    return true
  }
}

export function dismissDensityHint(): void {
  try {
    storage()?.setItem(DENSITY_HINT_KEY, SEEN)
  } catch {
    // Then it shows again next visit, which is the harmless direction to fail in.
  }
}

/**
 * Never call this during a server render or in the first render pass: the answer
 * depends on localStorage, the server cannot see it, and guessing would make the
 * markup disagree with the DOM after hydration.
 */
export function shouldShowDensityHint(): boolean {
  return readStoredDensity() === null && !densityHintDismissed()
}
