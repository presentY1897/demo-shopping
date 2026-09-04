'use client'

import type { Seller, SellerStatus } from '@shopping/shared'
import type { CursorPagination } from '@shopping/ui/components'
import { useCursorPagination } from '@shopping/ui/components'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ApiFailure } from '@/lib/api-failure'
import { apiFailure } from '@/lib/api-failure'

import { decideSellerReview, fetchSellerReviews } from './api'
import type { SellerDecision } from './decisions'

/**
 * The review queue: one page of it, the filter over it, and the four decisions.
 *
 * **Nothing is awaited during the server render.** The load runs in an effect,
 * so the page's markup — heading, filter, skeleton — is produced and sent while
 * the API may still be waking (TASK-0101 4.3). That is also what gives the
 * screen its four states rather than two.
 *
 * **Paging is `useCursorPagination`'s and the cursor is the query.** The history
 * of visited cursors is the one thing a keyset list has to remember, and it is
 * remembered in `packages/ui` where it is unit tested as input → output. This
 * hook only reads `pagination.cursor` back out and asks the API for that page.
 *
 * **A decision re-reads the page rather than patching the row.** Patching would
 * be wrong twice over: a decided row usually *leaves* the page when a status
 * filter is on, and the next page's contents depend on this page's last id. The
 * re-read is silent — rows stay on screen while it runs — so the queue does not
 * blink back to a skeleton after every click.
 */

export type SellerReviewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | {
      readonly status: 'ready'
      readonly sellers: readonly Seller[]
      readonly nextCursor: string | null
    }

/**
 * What a decision answers with.
 *
 * A result rather than a thrown error: the caller is a dialog that has to keep
 * rendering either way, and `conflict` is the one failure with a recovery of its
 * own — the queue has already been re-read, and the operator has to be told
 * that, or the row changing under them looks like their own click did it.
 */
export type SellerDecisionResult =
  | { readonly ok: true; readonly seller: Seller }
  | { readonly ok: false; readonly failure: ApiFailure; readonly conflict: boolean }

export interface SellerReviewController {
  readonly state: SellerReviewState
  /** `null` is 전체 — the query then carries no `status` at all. */
  readonly status: SellerStatus | null
  readonly select: (status: SellerStatus | null) => void
  readonly pagination: CursorPagination
  readonly reload: () => void
  readonly decide: (
    seller: Seller,
    decision: SellerDecision,
    reason?: string,
  ) => Promise<SellerDecisionResult>
}

export function useSellerReviewQueue(): SellerReviewController {
  const [state, setState] = useState<SellerReviewState>({ status: 'loading' })
  const [status, setStatus] = useState<SellerStatus | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  /**
   * A re-read that must not take the screen back to its skeleton.
   *
   * A ref rather than state: it is read by the effect that is already running
   * because of it, and a second state update would mean a second render before
   * the request even starts.
   */
  const silent = useRef(false)

  const pagination = useCursorPagination({
    nextCursor: state.status === 'ready' ? state.nextCursor : null,
  })
  const { cursor, reset } = pagination

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      if (!silent.current) setState({ status: 'loading' })
      silent.current = false

      try {
        const page = await fetchSellerReviews(
          {
            ...(status === null ? {} : { status }),
            ...(cursor === null ? {} : { cursor }),
          },
          { signal: controller.signal },
        )
        if (!controller.signal.aborted) {
          setState({ status: 'ready', sellers: page.sellers, nextCursor: page.nextCursor })
        }
      } catch (error) {
        if (controller.signal.aborted) return
        setState({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [status, cursor, reloadToken])

  /**
   * Changing the filter goes back to the first page.
   *
   * A cursor names a position *within one ordering and one filter*; carrying it
   * across a filter change would ask for "everything after this application"
   * among rows that no longer include it (`docs/design/pages.md` 커서 규약).
   */
  const select = useCallback(
    (next: SellerStatus | null): void => {
      setStatus(next)
      reset()
    },
    [reset],
  )

  const reload = useCallback((): void => {
    setReloadToken((token) => token + 1)
  }, [])

  const refresh = useCallback((): void => {
    silent.current = true
    setReloadToken((token) => token + 1)
  }, [])

  const decide = useCallback(
    async (
      seller: Seller,
      decision: SellerDecision,
      reason?: string,
    ): Promise<SellerDecisionResult> => {
      try {
        const { seller: decided } = await decideSellerReview(seller.id, decision, {
          version: seller.version,
          ...(reason === undefined ? {} : { reason }),
        })
        refresh()

        return { ok: true, seller: decided }
      } catch (error) {
        const failure = apiFailure(error)
        const conflict = failure.kind === 'http' && failure.status === 409

        // Somebody else decided first. Re-reading is not a retry — it is what
        // stops the screen from showing a row that no longer exists in that
        // state, and it is what the operator is told about (TASK-0110 F10).
        if (conflict) refresh()

        return { ok: false, failure, conflict }
      }
    },
    [refresh],
  )

  return { decide, pagination, reload, select, state, status }
}
