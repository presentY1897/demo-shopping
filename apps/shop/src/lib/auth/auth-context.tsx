'use client'

import type { SessionResponse } from '@shopping/shared'
import type { AuthorizationSubject } from '@shopping/shared'
import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { getSessionClient } from '@/lib/api'

import type { SessionClient, SessionRefusal } from './session-client'

/**
 * Who is signed in, for the whole app (TASK-0023 4장).
 *
 * **Three states, not two.** "Not signed in" and "we have not asked yet" look
 * the same to a naive boolean and mean opposite things to a screen: the first
 * is a reason to show a sign-in button, the second is a reason to show nothing
 * yet. Collapsing them is what makes a console flash its login page for a
 * fraction of a second on every reload for a signed-in operator.
 *
 * **The one request happens here, once.** Everything downstream — the console
 * guard, the permission hook, the user menu — reads this state rather than
 * calling the API again, so a screen with four permission-gated buttons still
 * costs one renewal.
 *
 * This file is one of the three identical copies described in
 * `lib/auth/session-client.ts`.
 */

export type AuthState =
  /** The boot renewal is in flight. Nothing is known yet. */
  | { readonly status: 'checking' }
  /**
   * Nobody is signed in. `refusal` says why, when the reason is worth telling:
   * `reused` means the session was ended on purpose and the person has to sign
   * in again rather than retry, and `unreachable` means the API never answered
   * — which is not a sign-in problem at all.
   */
  | { readonly status: 'anonymous'; readonly refusal: SessionRefusal | null }
  | { readonly status: 'signedIn'; readonly user: SessionResponse['user'] }

export interface AuthValue {
  readonly state: AuthState
  /**
   * The caller as the authorization table wants it, or `null` while unknown.
   *
   * Built here so that no screen assembles one itself: a subject with the wrong
   * `sellerId` would silently widen or narrow every `own` scope on the page.
   */
  readonly subject: AuthorizationSubject | null
  readonly signOut: () => Promise<void>
  /** Asks again. Used by the sign-in page after a successful round trip. */
  readonly recheck: () => Promise<AuthState>
}

const AuthContext = createContext<AuthValue | null>(null)

function stateOf(user: SessionResponse['user']): AuthState {
  return { status: 'signedIn', user }
}

export function AuthProvider({
  children,
  client,
}: {
  readonly children: ReactNode
  /** Injected by specs. Defaults to this app's singleton. */
  readonly client?: SessionClient
}) {
  const [state, setState] = useState<AuthState>({ status: 'checking' })

  // `useState` rather than `useMemo`: the client owns the access token, and a
  // memo is allowed to be discarded and recomputed, which would silently throw
  // the session away mid-session.
  const [session] = useState<SessionClient>(() => client ?? getSessionClient())

  const recheck = useCallback(async (): Promise<AuthState> => {
    const outcome = await session.renew()
    const next: AuthState = outcome.ok
      ? stateOf(outcome.session.user)
      : { status: 'anonymous', refusal: outcome.reason }

    setState(next)
    return next
  }, [session])

  useEffect(() => {
    let live = true

    void session.renew().then((outcome) => {
      if (!live) return

      setState(
        outcome.ok
          ? stateOf(outcome.session.user)
          : { status: 'anonymous', refusal: outcome.reason },
      )
    })

    // React 18+ runs effects twice in development. The renewal is single-flight,
    // so the second call joins the first rather than rotating the token twice.
    return () => {
      live = false
    }
  }, [session])

  const signOut = useCallback(async (): Promise<void> => {
    await session.logout()
    setState({ status: 'anonymous', refusal: null })
  }, [session])

  const value = useMemo<AuthValue>(
    () => ({
      state,
      subject:
        state.status === 'signedIn'
          ? { userId: state.user.id, roles: state.user.roles, sellerId: state.user.sellerId }
          : null,
      signOut,
      recheck,
    }),
    [state, signOut, recheck],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/**
 * Throws outside a provider rather than defaulting to anonymous.
 *
 * A default would make a forgotten provider look like a signed-out visitor: every
 * gated control would be disabled, every guard would redirect to the sign-in
 * page, and the screen would be wrong in a way that reads as correct.
 */
export function useAuth(): AuthValue {
  const value = useContext(AuthContext)

  if (value === null) throw new Error('useAuth was called outside <AuthProvider>')

  return value
}
