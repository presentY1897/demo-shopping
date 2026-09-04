'use client'

import type { DisplayDensity } from '@shopping/shared'
import type { DensityLevel } from '@shopping/ui'
import { DensityProvider, readStoredDensity } from '@shopping/ui/density'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import {
  densityLevelOf,
  densityToPromote,
  displayDensityOf,
} from '@/lib/profile/density-preference'
import { fetchPreference, savePreference } from '@/lib/profile/client'

/**
 * The half of the density system that belongs to an account (TASK-0112).
 *
 * `DensityProvider` has carried two unused props since TASK-0014 — `serverDensity`
 * and `onPersist` — with a comment naming M04 as the milestone that would fill
 * them. This is that. Everything the seam needs (the API client, the auth state,
 * the failure handling) lives in this app, which is exactly why the props were
 * left empty rather than guessed at.
 *
 * **Three things happen here, in this order.**
 *
 * 1. **Read.** Once somebody is signed in, `GET /me/preferences` says what the
 *    account holds. Until then the value is whatever localStorage had, which is
 *    what the boot script already painted.
 * 2. **Promote, once.** If this browser had a stored step and the account holds
 *    a different one, the stored one is lifted onto the account
 *    (`density-preference.ts` owns the decision). Without it, signing in would
 *    silently undo the choice a visitor made moments earlier.
 * 3. **Persist.** Every later change goes to the same endpoint. The server does
 *    not tell a promotion from an ordinary change, and does not need to.
 *
 * **Nothing here blocks the page.** Both requests run in effects and every
 * failure is swallowed on purpose: a display preference that could not be saved
 * is a preference that still applies to this device, and a storefront must not
 * refuse to render because a settings row would not load. The settings screen —
 * where somebody is *looking* at the toggle — is where a save failure is
 * reported (`DensitySection`).
 *
 * **Why it is not the settings screen's job.** The value has to be right on
 * every route, not only the one with the toggle on it, and the promotion has to
 * happen whether or not the shopper ever visits `/mypage/settings`.
 */
export function AccountDensityProvider({ children }: { readonly children: ReactNode }) {
  const { state } = useAuth()
  const userId = state.status === 'signedIn' ? state.user.id : null

  /**
   * The account's density, **together with whose account it is**.
   *
   * Keeping the id beside the number is what makes "somebody else is signed in
   * now, so the value no longer applies" a *derivation* rather than a `setState`
   * at the top of an effect — the effect-first version cascades a render on
   * every sign-out and is what `react-hooks/set-state-in-effect` refuses. It
   * also closes a real hole: the last person's density would otherwise keep
   * being re-applied to the next one's browser.
   */
  const [answered, setAnswered] = useState<{
    readonly userId: string
    readonly density: DensityLevel
  } | null>(null)

  const accountDensity = answered !== null && answered.userId === userId ? answered.density : null

  /**
   * Which account has already been promoted for.
   *
   * A ref rather than state, and keyed by the id rather than a boolean: a
   * boolean would re-arm on sign-out and re-promote for the next person to sign
   * in on the same tab, which is somebody else's account being written with this
   * browser's stored step (R2 — 세션당 1회).
   */
  const promotedFor = useRef<string | null>(null)

  useEffect(() => {
    if (userId === null) return undefined

    const controller = new AbortController()

    async function sync(id: string): Promise<void> {
      const preference = await fetchPreference({ signal: controller.signal })
      if (controller.signal.aborted) return

      const promote = promotedFor.current === id ? null : promotable(preference.density)
      promotedFor.current = id

      if (promote === null) {
        setAnswered({ userId: id, density: densityLevelOf(preference.density) })
        return
      }

      // The screen already shows the stored step — the boot script painted it —
      // so this is the account catching up with the browser rather than the
      // other way round.
      setAnswered({ userId: id, density: densityLevelOf(promote) })
      await savePreference({ density: promote }, { signal: controller.signal })
    }

    void sync(userId).catch(() => {
      // A settings row that would not load or would not save is not a reason to
      // break a storefront. The device keeps the density it is showing.
    })

    return () => {
      controller.abort()
    }
  }, [userId])

  const persist = useCallback(
    (level: DensityLevel) => {
      // Signed out, the toggle in the header is still a working control and
      // localStorage is the whole of its storage. Calling `/me` here would be a
      // guaranteed 401 on every click.
      if (userId === null) return

      setAnswered({ userId, density: level })

      void savePreference({ density: displayDensityOf(level) }).catch(() => {
        // Reported where somebody can see it: the settings screen saves through
        // its own handler and shows the failure beside the control.
      })
    },
    [userId],
  )

  return (
    <DensityProvider onPersist={persist} serverDensity={accountDensity}>
      {children}
    </DensityProvider>
  )
}

/** What this browser stored while signed out, if it disagrees with the account. */
function promotable(server: DisplayDensity): DisplayDensity | null {
  return densityToPromote(readStoredDensity(), server)
}
