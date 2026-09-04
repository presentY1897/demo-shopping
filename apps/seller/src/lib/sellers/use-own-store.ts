'use client'

import type {
  ApiFailure,
  Seller,
  SellerApplicationRequest,
  SellerStoreUpdateRequest,
} from '@shopping/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFailure } from '@shopping/shared'

import { fetchOwnStore, saveOwnStore, submitApplication } from './store-api'
import { isMissingStore, isVersionConflict } from './store-failures'

/**
 * The store this account owns, and the two things the console does to it
 * (TASK-0109 4장).
 *
 * **Four states, and `absent` is not an error.** `GET /sellers/me` answers 404
 * for somebody who has never applied, which is the most ordinary visitor this
 * screen has. Folding it into `error` would show a failure notice to a person
 * whose only problem is that they have not filled in the form yet; folding it
 * into `ready` would need a `Seller | null` that every reader has to branch on.
 *
 * **Nothing is awaited during the server render.** The read runs in an effect,
 * so the heading and the skeleton are produced and sent while the API may still
 * be waking (TASK-0101 4.3) — and that is also what gives the screen its
 * loading state rather than a blank first paint.
 *
 * **The status is read here rather than taken from the session.** The reasons
 * are in TASK-0109 4장: `statusReason` would put a seller-domain field in the
 * login response that all three apps share, and a value carried on the access
 * token is up to fifteen minutes stale — long enough for an approval to be
 * invisible for the whole of a demo.
 */

export type OwnStoreState =
  /** The read is in flight. Nothing is known yet. */
  | { readonly status: 'loading' }
  /** The account has never applied. The form starts empty. */
  | { readonly status: 'absent' }
  | { readonly status: 'ready'; readonly seller: Seller }
  /** The read itself failed — not a refusal about the store, but no answer. */
  | { readonly status: 'error'; readonly failure: ApiFailure }

/**
 * What a write answers with.
 *
 * A result rather than a thrown error: the form has to keep rendering with the
 * text the person typed, and `conflict` carries the one thing a lost optimistic
 * lock leaves the screen needing — the row as it now stands, so that reloading
 * is an option the reader can take rather than a suggestion.
 */
export type StoreWriteResult =
  | { readonly ok: true; readonly seller: Seller }
  | { readonly ok: false; readonly failure: ApiFailure; readonly conflict?: Seller }

export interface OwnStoreController {
  readonly state: OwnStoreState
  readonly reload: () => void
  /** `POST /sellers/applications` — 신청, and 재신청 from `REJECTED`. */
  readonly apply: (input: SellerApplicationRequest) => Promise<StoreWriteResult>
  /** `PATCH /sellers/me` — the store's own copy, in every status. */
  readonly save: (input: SellerStoreUpdateRequest) => Promise<StoreWriteResult>
}

export function useOwnStore(): OwnStoreController {
  const [state, setState] = useState<OwnStoreState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)

  /**
   * Whether this hook is still mounted.
   *
   * A write's `setState` cannot be cancelled by an `AbortController` the way the
   * read's can — the request has already been sent and its result matters — so
   * the guard is a flag rather than a signal.
   */
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    const controller = new AbortController()

    async function read(): Promise<void> {
      try {
        const { seller } = await fetchOwnStore(controller.signal)
        if (!controller.signal.aborted) setState({ status: 'ready', seller })
      } catch (error) {
        if (controller.signal.aborted) return

        const failure = apiFailure(error)
        setState(isMissingStore(failure) ? { status: 'absent' } : { status: 'error', failure })
      }
    }

    void read()

    return () => {
      live.current = false
      controller.abort()
    }
  }, [reloadToken])

  /**
   * Back to loading, and round again.
   *
   * The state change is here rather than at the top of the effect: an effect
   * that sets state as its first act renders twice for every read, and every
   * caller of this is already an event.
   */
  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setReloadToken((previous) => previous + 1)
  }, [])

  /** Adopts what a successful write answered with. One round trip, not two. */
  const adopt = useCallback((seller: Seller): StoreWriteResult => {
    if (live.current) setState({ status: 'ready', seller })

    return { ok: true, seller }
  }, [])

  const apply = useCallback(
    async (input: SellerApplicationRequest): Promise<StoreWriteResult> => {
      try {
        return adopt((await submitApplication(input)).seller)
      } catch (error) {
        return { ok: false, failure: apiFailure(error) }
      }
    },
    [adopt],
  )

  /**
   * Saves the store's copy.
   *
   * On a version conflict the row is read again — **for showing, not for
   * saving.** Nothing on screen is overwritten by it: the reader decides whether
   * to take the server's version or to write theirs on top of it, and until they
   * do, what they typed stays exactly where they typed it (F6, DECISIONS 4장 —
   * 덮어쓰기 없음).
   */
  const save = useCallback(
    async (input: SellerStoreUpdateRequest): Promise<StoreWriteResult> => {
      try {
        return adopt((await saveOwnStore(input)).seller)
      } catch (error) {
        const failure = apiFailure(error)
        if (!isVersionConflict(failure)) return { ok: false, failure }

        const latest = await fetchOwnStore().then(
          ({ seller }) => seller,
          () => undefined,
        )

        return latest === undefined
          ? { ok: false, failure }
          : { ok: false, failure, conflict: latest }
      }
    },
    [adopt],
  )

  return { state, reload, apply, save }
}
