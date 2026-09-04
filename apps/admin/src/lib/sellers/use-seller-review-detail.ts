'use client'

import type { Seller } from '@shopping/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ApiFailure } from '@/lib/api-failure'
import { apiFailure } from '@/lib/api-failure'

import { decideSellerReview, fetchSellerReview } from './api'
import type { SellerDecision } from './decisions'
import type { SellerDecisionResult } from './use-seller-review'

/**
 * One application, and the same four decisions the queue offers.
 *
 * The split from {@link useSellerReviewQueue} is only what is being held — a
 * row versus a page, and a cursor the detail has no use for. **The decision path
 * is deliberately the same shape in both**, down to `SellerDecisionResult`, so
 * that `SellerDecisionDialog` never has to know which screen opened it
 * (TASK-0110 R6).
 */

export type SellerReviewDetailState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly seller: Seller }

export interface SellerReviewDetailController {
  readonly state: SellerReviewDetailState
  readonly reload: () => void
  readonly decide: (decision: SellerDecision, reason?: string) => Promise<SellerDecisionResult>
}

export function useSellerReviewDetail(id: string): SellerReviewDetailController {
  const [state, setState] = useState<SellerReviewDetailState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)

  /** The row as it is *now*, readable outside a render — a decision needs its version. */
  const sellerRef = useRef<Seller | null>(null)

  const silent = useRef(false)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      if (!silent.current) setState({ status: 'loading' })
      silent.current = false

      try {
        const { seller } = await fetchSellerReview(id, { signal: controller.signal })
        if (controller.signal.aborted) return
        sellerRef.current = seller
        setState({ status: 'ready', seller })
      } catch (error) {
        if (controller.signal.aborted) return
        sellerRef.current = null
        setState({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [id, reloadToken])

  const reload = useCallback((): void => {
    setReloadToken((token) => token + 1)
  }, [])

  const decide = useCallback(
    async (decision: SellerDecision, reason?: string): Promise<SellerDecisionResult> => {
      const seller = sellerRef.current

      // Nothing is loaded, so there is no version to write against. Reported as
      // a transport failure rather than thrown: the dialog has to keep drawing.
      if (seller === null) {
        return {
          ok: false,
          failure: { kind: 'transport', reason: 'unknown' },
          conflict: false,
        }
      }

      try {
        const { seller: decided } = await decideSellerReview(seller.id, decision, {
          version: seller.version,
          ...(reason === undefined ? {} : { reason }),
        })
        sellerRef.current = decided
        setState({ status: 'ready', seller: decided })

        return { ok: true, seller: decided }
      } catch (error) {
        const failure = apiFailure(error)
        const conflict = failure.kind === 'http' && failure.status === 409

        // Read again so the screen shows what is actually stored — never the
        // value this operator was about to write over (DECISIONS 4장).
        if (conflict) {
          silent.current = true
          setReloadToken((token) => token + 1)
        }

        return { ok: false, failure, conflict }
      }
    },
    [],
  )

  return { decide, reload, state }
}
