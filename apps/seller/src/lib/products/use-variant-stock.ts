'use client'

import type {
  ApiFailure,
  SellerVariant,
  StockAdjustRequest,
  StockLedgerEntry,
} from '@shopping/shared'
import { apiFailure } from '@shopping/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

import { adjustVariantStock, fetchSellerVariants, fetchVariantLedger } from './console-api'

/**
 * One listing's combinations, the adjustments made to them, and the history
 * behind each number.
 *
 * **An accepted adjustment patches the row it changed and nothing else**
 * (R2). The response carries `balanceAfter`, which is the same number the next
 * read would produce, so re-reading the whole table would cost a request to
 * learn what the answer already said. The *listing total* on the previous screen
 * is a different matter — that is fixed by the next list read, which is what R2
 * settles for.
 *
 * **The history is loaded per combination, on demand.** Twelve combinations
 * would otherwise be twelve ledger requests on arrival, and the seller is
 * looking at one of them.
 */

export type VariantStockState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly variants: readonly SellerVariant[] }

export type LedgerState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly failure: ApiFailure }
  | { readonly status: 'ready'; readonly entries: readonly StockLedgerEntry[] }

export type AdjustResult =
  | { readonly ok: true; readonly balanceAfter: number }
  | { readonly ok: false; readonly failure: ApiFailure }

export interface VariantStockController {
  readonly state: VariantStockState
  readonly reload: () => void
  readonly adjust: (variantId: string, body: StockAdjustRequest) => Promise<AdjustResult>
  /** Which combination's history is open, and what is in it. */
  readonly openLedger: string | null
  readonly ledger: LedgerState | null
  readonly toggleLedger: (variantId: string) => void
}

export function useVariantStock(productId: string): VariantStockController {
  const [state, setState] = useState<VariantStockState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)
  const [openLedger, setOpenLedger] = useState<string | null>(null)
  const [ledgerState, setLedgerState] = useState<LedgerState | null>(null)

  /** Bumped by an adjustment so the open history re-reads without a flicker. */
  const ledgerToken = useRef(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load(): Promise<void> {
      setState({ status: 'loading' })

      try {
        const answer = await fetchSellerVariants(productId, { signal: controller.signal })

        if (controller.signal.aborted) return

        setState({ status: 'ready', variants: answer.variants })
      } catch (error) {
        if (controller.signal.aborted) return

        setState({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [productId, reloadToken])

  useEffect(() => {
    // Closing is not a load. Whether there is a history on screen is derived
    // from `openLedger` below rather than written here — an effect that cleared
    // the state synchronously would be a render caused by a click that already
    // caused one.
    if (openLedger === null) return

    const controller = new AbortController()
    const variantId = openLedger

    async function load(): Promise<void> {
      setLedgerState({ status: 'loading' })

      try {
        const answer = await fetchVariantLedger(variantId, {}, { signal: controller.signal })

        if (controller.signal.aborted) return

        setLedgerState({ status: 'ready', entries: answer.entries })
      } catch (error) {
        if (controller.signal.aborted) return

        setLedgerState({ status: 'error', failure: apiFailure(error) })
      }
    }

    void load()

    return () => {
      controller.abort()
    }
  }, [openLedger, reloadToken])

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const adjust = useCallback(
    async (variantId: string, body: StockAdjustRequest): Promise<AdjustResult> => {
      try {
        const answer = await adjustVariantStock(variantId, body)

        // Patch the one row. The server just told us what it is; asking again
        // would be asking a question we hold the answer to.
        setState((held) =>
          held.status === 'ready'
            ? {
                status: 'ready',
                variants: held.variants.map((variant) =>
                  variant.id === variantId ? { ...variant, stock: answer.balanceAfter } : variant,
                ),
              }
            : held,
        )

        ledgerToken.current += 1
        // The open history is now one entry short of the truth.
        if (openLedger === variantId) setReloadToken((token) => token + 1)

        return { ok: true, balanceAfter: answer.balanceAfter }
      } catch (error) {
        // Nothing is patched. F9 asks that a refused adjustment leave the number
        // on screen alone, and the way that is guaranteed is that the only write
        // to `state` is on the success path.
        return { ok: false, failure: apiFailure(error) }
      }
    },
    [openLedger],
  )

  const toggleLedger = useCallback((variantId: string) => {
    setOpenLedger((held) => (held === variantId ? null : variantId))
  }, [])

  return {
    state,
    reload,
    adjust,
    openLedger,
    // Derived: a closed history has nothing in it, and that is a fact about
    // `openLedger`, not a second piece of state to keep in step with it.
    ledger: openLedger === null ? null : ledgerState,
    toggleLedger,
  }
}
