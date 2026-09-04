'use client'

import type {
  ApiFailure,
  Profile,
  ProfileUpdateRequest,
  UserPreference,
  UserPreferenceUpdateRequest,
  WithdrawalResponse,
} from '@shopping/shared'
import { useCallback, useEffect, useState } from 'react'
import { apiFailure } from '@shopping/shared'

import { fetchProfile, saveProfile, savePreference, withdraw } from './client'

/**
 * The account behind `/mypage/settings` — profile, settings, withdrawal.
 *
 * **One read, not two.** `GET /me` answers the profile *and* the settings row,
 * because the screen that shows one shows the other and two round trips for one
 * screen is a cost paid on every cold start (TASK-0111 4장). So there is one
 * loading state here and not two half-drawn panels.
 *
 * **Nothing is awaited during the server render.** The load runs in an effect,
 * so the page's markup — heading, headings, skeleton — is produced and sent
 * while the API may still be waking up (TASK-0101 4.3). That is also what gives
 * the screen its three states rather than one.
 */

export type AccountState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly profile: Profile
      readonly preference: UserPreference
    }

/**
 * What a write answers with.
 *
 * A result rather than a thrown error: every caller is a form or a dialog that
 * has to keep rendering, and a rejection that escaped would take the screen
 * down over a failed save.
 */
export type MutationResult =
  { readonly ok: true } | { readonly ok: false; readonly failure: ApiFailure }

export type WithdrawalResult =
  | { readonly ok: true; readonly receipt: WithdrawalResponse }
  | { readonly ok: false; readonly failure: ApiFailure }

const SUCCESS: MutationResult = { ok: true }

export interface AccountConsole {
  readonly state: AccountState
  readonly reload: () => void
  readonly saveProfile: (body: ProfileUpdateRequest) => Promise<MutationResult>
  readonly savePreference: (body: UserPreferenceUpdateRequest) => Promise<MutationResult>
  readonly withdraw: () => Promise<WithdrawalResult>
}

export function useAccount(): AccountConsole {
  const [state, setState] = useState<AccountState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      try {
        const { profile, preference } = await fetchProfile({ signal: controller.signal })
        if (controller.signal.aborted) return

        setState({ status: 'ready', profile, preference })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [reloadToken])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setReloadToken((token) => token + 1)
  }, [])

  /**
   * Writes the answer straight into state rather than re-reading.
   *
   * Unlike the attribute console, where one write changes what a *different*
   * row inherits, `PATCH /me` answers with the whole of what this screen shows.
   * A second request would be asking a question already answered.
   */
  const writeProfile = useCallback(async (body: ProfileUpdateRequest): Promise<MutationResult> => {
    try {
      const { profile, preference } = await saveProfile(body)
      setState({ status: 'ready', profile, preference })

      return SUCCESS
    } catch (error) {
      return { ok: false, failure: apiFailure(error) }
    }
  }, [])

  const writePreference = useCallback(
    async (body: UserPreferenceUpdateRequest): Promise<MutationResult> => {
      try {
        const preference = await savePreference(body)
        // Only the settings half changes, and the profile half is not re-read:
        // `PATCH /me/preferences` does not answer with it, and inventing one
        // from the stale copy would be the screen guessing.
        setState((current) => (current.status === 'ready' ? { ...current, preference } : current))

        return SUCCESS
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      }
    },
    [],
  )

  /**
   * Withdrawal, which does **not** touch `state`.
   *
   * The account is gone, so re-reading it would be a 404 and re-rendering the
   * form would be showing somebody a profile that no longer exists. The screen
   * replaces itself with the receipt instead.
   */
  const closeAccount = useCallback(async (): Promise<WithdrawalResult> => {
    try {
      return { ok: true, receipt: await withdraw() }
    } catch (error) {
      return { ok: false, failure: apiFailure(error) }
    }
  }, [])

  return {
    reload,
    savePreference: writePreference,
    saveProfile: writeProfile,
    state,
    withdraw: closeAccount,
  }
}
