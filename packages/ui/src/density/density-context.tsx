'use client'

/**
 * React access to the density store.
 *
 * The provider holds no state of its own. It subscribes to the store through
 * `useSyncExternalStore`, which is the one hook that can tell React "the value
 * the server rendered was 2, the value on this client is 3" without a hydration
 * mismatch: React hydrates with the server snapshot and re-renders with the
 * client snapshot immediately afterwards.
 */

import type { ReactNode } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react'

import { DEFAULT_DENSITY, DENSITY_LEVELS, type DensityLevel } from './density'
import { getDensitySnapshot, setDensity as writeDensity, subscribeToDensity } from './density-store'

export interface DensityContextValue {
  readonly density: DensityLevel
  readonly setDensity: (level: DensityLevel) => void
  /** The steps a toggle should offer, in order. */
  readonly levels: readonly DensityLevel[]
}

const DensityContext = createContext<DensityContextValue | null>(null)

export interface DensityProviderProps {
  readonly children: ReactNode
  /**
   * The signed-in shopper's stored preference.
   *
   * **This is the seam for M04.** Until accounts exist it is always `null` and
   * the density is whatever localStorage holds. Once `UserPreference` is real,
   * the root layout reads it server side and passes it here; it then wins over
   * localStorage both at first paint (via `DensityScript`, which takes the same
   * value) and on a later sign-in (the effect below), and is mirrored back into
   * localStorage so the device agrees with the account.
   */
  readonly serverDensity?: DensityLevel | null
  /**
   * Called after every change the user makes.
   *
   * **The other half of the M04 seam**: the place a `PATCH /me/preferences` goes.
   * Deliberately not built in — the API client, the auth state and the failure
   * handling all belong to that milestone, and guessing at them here would mean
   * writing code twice.
   */
  readonly onPersist?: (level: DensityLevel) => void
}

export function DensityProvider({
  children,
  serverDensity = null,
  onPersist,
}: DensityProviderProps) {
  const serverSnapshot = serverDensity ?? DEFAULT_DENSITY

  const density = useSyncExternalStore(subscribeToDensity, getDensitySnapshot, () => serverSnapshot)

  // A value arriving from the account after the page is already up — a sign-in,
  // a preference changed in another tab and refetched. First paint is handled by
  // the boot script, which sees the same number.
  useEffect(() => {
    if (serverDensity !== null && serverDensity !== getDensitySnapshot())
      writeDensity(serverDensity)
  }, [serverDensity])

  const setDensity = useCallback(
    (level: DensityLevel) => {
      writeDensity(level)
      onPersist?.(level)
    },
    [onPersist],
  )

  const value = useMemo<DensityContextValue>(
    () => ({ density, setDensity, levels: DENSITY_LEVELS }),
    [density, setDensity],
  )

  return <DensityContext value={value}>{children}</DensityContext>
}

/**
 * Throws outside a provider rather than falling back to the default: a toggle
 * that silently does nothing is far harder to notice than one that fails loudly
 * the first time it is rendered.
 */
export function useDensity(): DensityContextValue {
  const value = useContext(DensityContext)
  if (value === null) {
    throw new Error('useDensity() must be called inside <DensityProvider>.')
  }
  return value
}
