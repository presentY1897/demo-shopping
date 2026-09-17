'use client'

import { Button } from '@shopping/ui/components'
import type { ReactNode } from 'react'

import { SectionReadiness } from '@/lib/products/section-readiness'
import { useApiWake } from '@/lib/use-api-wake'
import type { WakePolicy } from '@/lib/wake-policy'
import { WAKE_POLICY } from '@/lib/wake-policy'
import type { WakeMessages } from '@/messages'

interface ApiWakeGateProps {
  readonly wake: WakeMessages
  readonly children?: ReactNode
  readonly policy?: WakePolicy
}

// The rows under this gate *are* searches, so an API that is up beside an engine
// that is not is still "not yet": the wake-up keeps asking inside the same
// budget instead of stopping to offer a button (TASK-0143 4.3).
const WAITS_FOR_SEARCH = { waitForSearch: true } as const

// Keep prewarming in the browser; a healthy storefront needs no status panel.
export function ApiWakeGate({ children, wake, policy = WAKE_POLICY }: ApiWakeGateProps) {
  const state = useApiWake(policy, WAITS_FOR_SEARCH)
  const ready = state.result?.ok === true && state.result.response.search === 'ok'
  // The loop has returned and the storefront is still not usable: the API never
  // answered, or the budget ended with the engine still away. Either way nothing
  // more is asked until the visitor does, so both get the same words and button.
  const failed = state.result !== null && !ready
  // An engine that is known to be away is explained at once. The three quiet
  // seconds are for a wait that might still turn out to be an ordinary load.
  const waiting =
    state.result === null && (state.searchPending || state.elapsedMs >= policy.noticeAfterMs)

  return (
    <SectionReadiness value={ready ? 'ready' : failed ? 'failed' : 'pending'}>
      {children}
      {failed ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-fg-muted text-sm">{wake.storefrontFailed}</p>
          <Button onClick={state.retry} size="sm" variant="outline">
            {wake.retryLabel}
          </Button>
        </div>
      ) : waiting ? (
        <div className="flex flex-wrap items-center gap-3" role="status">
          <p className="text-fg-muted text-sm">{wake.storefrontPreparing}</p>
        </div>
      ) : null}
    </SectionReadiness>
  )
}
