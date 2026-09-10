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

// Keep prewarming in the browser; a healthy storefront needs no status panel.
export function ApiWakeGate({ children, wake, policy = WAKE_POLICY }: ApiWakeGateProps) {
  const state = useApiWake(policy)
  const ready = state.result?.ok === true && state.result.response.search === 'ok'
  const failed = state.result !== null && !state.result.ok
  const searchPending = state.result?.ok === true && !ready
  const waiting =
    searchPending || (state.result === null && state.elapsedMs >= policy.noticeAfterMs)

  return (
    <SectionReadiness value={ready}>
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
          {searchPending ? (
            <Button onClick={state.retry} size="sm" variant="outline">
              {wake.retryLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </SectionReadiness>
  )
}
