'use client'

import { useApiWake } from '@/lib/use-api-wake'
import type { WakePolicy } from '@/lib/wake-policy'
import { WAKE_POLICY } from '@/lib/wake-policy'
import type { HealthMessages, WakeMessages } from '@/messages'

import { HealthPanel } from './health-panel'
import { SearchReadiness } from './search-readiness'
import { WakeFailure } from './wake-failure'
import { WakeWaiting } from './wake-waiting'

interface ApiWakeGateProps {
  readonly health: HealthMessages
  readonly wake: WakeMessages
  /**
   * Injected only by specs, which pass millisecond thresholds to reproduce a 90
   * second sequence instantly. Must be a stable reference — `useApiWake` treats
   * it as an effect dependency.
   */
  readonly policy?: WakePolicy
}

/**
 * The four states the API connection can be in, and the request that starts
 * them.
 *
 * | state | what the visitor sees |
 * | --- | --- |
 * | waiting | skeleton, then the wake-up notice with elapsed time |
 * | ready, search usable | the health panel |
 * | ready, search not usable | the panel plus "검색 준비 중" instead of a search |
 * | failed | the panel's own failure copy plus a retry button |
 *
 * This is a client component and the request lives in its effect, which is what
 * keeps the server render free of awaits: the page's HTML — heading, copy,
 * skeleton — is produced and sent while the API is still booting (F4).
 */
export function ApiWakeGate({ health, wake, policy = WAKE_POLICY }: ApiWakeGateProps) {
  const state = useApiWake(policy)

  if (state.result === null) {
    return (
      <WakeWaiting
        attempt={state.attempt}
        attempts={state.attempts}
        elapsedMs={state.elapsedMs}
        messages={wake}
        policy={policy}
        title={health.title}
      />
    )
  }

  return (
    <>
      <HealthPanel messages={health} result={state.result} />

      {state.result.ok ? (
        <SearchReadiness
          autoRechecking={state.searchRechecks < state.searchRecheckBudget}
          messages={wake.search}
          onRecheck={state.retry}
          status={state.result.response.search}
        />
      ) : (
        <WakeFailure attempts={state.attempts} messages={wake} onRetry={state.retry} />
      )}
    </>
  )
}
