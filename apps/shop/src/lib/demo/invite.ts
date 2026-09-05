/**
 * Whether the first-visit demo nudge is still owed (TASK-0044 F5 · R2).
 *
 * The same shape as the density hint's record (`lib/density-hint.ts`) and for the
 * same reasons: **once, and easy to close**. A second visit that shows the same
 * notice is not guidance, it is an advertisement.
 *
 * Every access is wrapped. Reading `localStorage` throws outright in Safari's
 * private mode and wherever site data is blocked, and an unreadable answer is
 * treated as **seen** — nagging somebody who cannot be remembered on every page
 * load is the worse way to fail.
 *
 * `subscribe` exists so a component can read this through
 * `useSyncExternalStore`: the value is not React's, the server cannot see it,
 * and rendering a guess would be a hydration mismatch.
 */

export const DEMO_INVITE_KEY = 'shopping.shop.demo.invite'

/** The value written; only its presence is read. */
const SEEN = 'seen'

const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function subscribeToDemoInvite(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export function shouldShowDemoInvite(): boolean {
  try {
    return storage()?.getItem(DEMO_INVITE_KEY) !== SEEN
  } catch {
    return false
  }
}

export function dismissDemoInvite(): void {
  try {
    storage()?.setItem(DEMO_INVITE_KEY, SEEN)
  } catch {
    // Then it shows again next visit, which is the harmless direction to fail in.
  }

  for (const listener of listeners) listener()
}
