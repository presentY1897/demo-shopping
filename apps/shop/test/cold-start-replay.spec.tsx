/**
 * Optional replay of a 90-second cold start using the production retry policy.
 * Run with COLD_START_REPLAY=1. The storefront shows a brief notice after 3s
 * and removes it once search is ready; technical counters remain internal.
 *
 * **Two shapes of platform, one policy.** `sleepingInstance` refuses instantly
 * while it boots, which is what Render was measured doing; `heldRequestInstance`
 * holds the request open until it answers, which is what this file used to
 * assume. A policy that budgets by attempt passes the second and fails the
 * first — it is spent in about four seconds, and this replay then ends on the
 * failure notice with 86 seconds of boot still to go (TASK-0118 4.3 · 4.6).
 *
 * The storefront has no second-stage notice to reach (DECISIONS 콜드 스타트), so
 * what is timed here is the one notice and its removal. The two-stage console
 * screen is replayed in `apps/seller/test/cold-start-replay.spec.tsx`.
 */

import { healthOk, heldRequestInstance, mockPaths, sleepingInstance } from '@shopping/api-mocks'
import { render, screen, waitForElementToBeRemoved } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiWakeGate } from '@/components/api-wake-gate'
import { WAKE_POLICY } from '@/lib/wake-policy'
import { messagesFor } from '@/messages'

import { testServer } from './setup'

const { wake } = messagesFor()

/** Measured against the deployed API on 2026-09-03 (TASK-0101 4.1). */
const MEASURED_COLD_START_MS = 90_000

/**
 * What the replay itself costs, over and above the sequence it is replaying.
 *
 * The instant-refusal model turns the loop about fifteen times in ninety
 * seconds, and each turn is a real request through msw and a real React render.
 * **Not part of the policy** — it is the price of running this at full speed
 * rather than against a stubbed clock.
 */
const REPLAY_OVERHEAD_MS = 20_000

const enabled = process.env.COLD_START_REPLAY === '1'

/** The two shapes a sleeping platform can take, both replayed. */
const PLATFORMS = [
  { name: '즉시 거절 (Render 실측)', handler: sleepingInstance },
  { name: '요청 보류 (옛 모델)', handler: heldRequestInstance },
] as const

describe.skipIf(!enabled)('a 90 second cold start, at full speed', () => {
  it.each(PLATFORMS)(
    'keeps the page up, briefly explains the wait, and recovers by itself — $name',
    { timeout: 200_000 },
    async ({ handler }) => {
      testServer.server.use(handler(mockPaths.health, MEASURED_COLD_START_MS, healthOk))

      const startedAt = performance.now()
      const at = (): number => Math.round(performance.now() - startedAt)
      const milestones: Record<string, number> = {}

      render(<ApiWakeGate policy={WAKE_POLICY} wake={wake} />)

      // The page is up from the first frame — nothing waited on the API.
      expect(screen.queryByText(wake.storefrontPreparing)).toBeNull()
      milestones.shell = at()

      await screen.findByText(wake.storefrontPreparing, undefined, { timeout: 10_000 })
      milestones.notice = at()

      // The notice goes away on success *and* on failure, so its removal alone
      // proves nothing — the attempt-count policy removed it four seconds in, by
      // giving up. What separates the two is asserted below: when it went, and
      // that no failure took its place.
      await waitForElementToBeRemoved(() => screen.queryByText(wake.storefrontPreparing), {
        timeout: 150_000,
      })
      milestones.ready = at()

      // Preserve the production timing contract while simplifying the visible copy.
      expect(milestones.shell).toBeLessThan(1_000)
      expect(milestones.notice).toBeGreaterThanOrEqual(WAKE_POLICY.noticeAfterMs)
      expect(milestones.notice).toBeLessThan(WAKE_POLICY.noticeAfterMs + 2_000)
      // The instance answered on its own schedule and an attempt caught it — no
      // button was pressed anywhere in this test, and the notice did not give
      // way to a failure: a gate that fails stays failed until somebody acts.
      //
      // **The bound has two parts, and only the first is a claim.** Boot plus one
      // backoff ceiling is the structural worst case: an attempt refused just
      // before the instance came up sleeps a whole ceiling before the next one
      // (TASK-0118 4.5). The rest is what this replay costs to run.
      expect(milestones.ready).toBeGreaterThanOrEqual(MEASURED_COLD_START_MS)
      expect(milestones.ready).toBeLessThan(
        MEASURED_COLD_START_MS + (WAKE_POLICY.backoffMs.at(-1) ?? 0) + REPLAY_OVERHEAD_MS,
      )
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.queryByRole('button', { name: wake.retryLabel })).toBeNull()
    },
  )
})
