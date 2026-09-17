/**
 * The real thing, at real speed: a 90 second cold start replayed against the
 * production wake-up policy, on the console gate `seller` and `admin` share.
 *
 * **Skipped unless asked for.** It takes about three minutes — a minute and a
 * half per platform — which does not belong in `pnpm test` or in CI. It belongs
 * in the repository because a measurement nobody can repeat is an anecdote:
 *
 * ```bash
 * COLD_START_REPLAY=1 pnpm --filter @shopping/seller test cold-start-replay
 * ```
 *
 * **Why this lives here and not only in `apps/shop`.** The storefront replay
 * times one brief notice and its removal; the storefront has no second-stage
 * notice (DECISIONS 콜드 스타트). The "최대 2분" line at 15 seconds is a console
 * screen, and it is the one the attempt-count policy could never reach — it had
 * given up eleven seconds earlier (TASK-0118 4.3, F3).
 *
 * With `WAKE_POLICY` against an instant refusal that produces:
 *
 * | t | what happens |
 * | --- | --- |
 * | 0s | request 1 goes out, spin-up begins, skeleton on screen |
 * | 0s+ | the platform refuses instantly; the loop backs off 1s and asks again |
 * | 3s | "서버를 준비하는 중입니다" + elapsed counter + progress bar |
 * | 15s | the notice adds the "최대 2분" line |
 * | 15s~ | the backoff has reached its 8s ceiling and stays there |
 * | 90s | the instance is up; the next attempt gets an answer |
 *
 * **Two shapes of platform, one policy.** `sleepingInstance` refuses instantly
 * while it boots, which is what Render was measured doing; `heldRequestInstance`
 * holds the request open until it answers, which is what the replay used to
 * assume. The policy has to carry both, and the replay runs against each — a
 * policy that budgets by attempt passes the second and fails the first
 * (TASK-0118 4.6).
 *
 * The assertions below are the record: they bound each milestone tightly enough
 * that the table above cannot drift without this failing.
 */

import { healthOk, heldRequestInstance, mockPaths, sleepingInstance } from '@shopping/api-mocks'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiWakeGate } from '@/components/api-wake-gate'
import { WAKE_POLICY } from '@/lib/wake-policy'
import { messagesFor } from '@/messages'

import { testServer } from './setup'

const { health, wake } = messagesFor()

/** Measured against the deployed API on 2026-09-03 (TASK-0101 4.1). */
const MEASURED_COLD_START_MS = 90_000

/**
 * Slack for running this at full speed — real requests through msw, real
 * renders, `findBy` polling. **Not part of the policy.**
 *
 * It used to be 20 seconds, to fit a run that came up at 103s. That was not
 * overhead. The double timed the boot on `Date.now()`, the system clock was
 * being stepped back 1.7s every half minute underneath it, and the attempt the
 * schedule puts at 95s was refused by a clock that had not reached 90 yet. On
 * the monotonic clock the same run lands at 95.1s (TASK-0118 6.3).
 */
const REPLAY_OVERHEAD_MS = 3_000

const enabled = process.env.COLD_START_REPLAY === '1'

/** The two shapes a sleeping platform can take, both replayed. */
const PLATFORMS = [
  { name: '즉시 거절 (Render 실측)', handler: sleepingInstance },
  { name: '요청 보류 (옛 모델)', handler: heldRequestInstance },
] as const

describe.skipIf(!enabled)('a 90 second cold start, at full speed', () => {
  it.each(PLATFORMS)(
    'keeps the page up, explains the wait in two stages, and recovers by itself — $name',
    { timeout: 200_000 },
    async ({ handler }) => {
      testServer.server.use(handler(mockPaths.health, MEASURED_COLD_START_MS, healthOk))

      const startedAt = performance.now()
      const at = (): number => Math.round(performance.now() - startedAt)
      const milestones: Record<string, number> = {}

      render(<ApiWakeGate health={health} policy={WAKE_POLICY} wake={wake} />)

      // The page is up from the first frame — nothing waited on the API.
      expect(screen.getByRole('region', { name: health.title })).toHaveAttribute(
        'aria-busy',
        'true',
      )
      expect(screen.queryByText(wake.preparing)).toBeNull()
      milestones.shell = at()

      await screen.findByText(wake.preparing, undefined, { timeout: 10_000 })
      milestones.notice = at()

      await screen.findByText(wake.coldStartNotice, undefined, { timeout: 20_000 })
      milestones.coldNotice = at()

      await screen.findByText(healthOk.version, undefined, { timeout: 150_000 })
      milestones.ready = at()

      expect(milestones.shell).toBeLessThan(1_000)
      expect(milestones.notice).toBeGreaterThanOrEqual(WAKE_POLICY.noticeAfterMs)
      expect(milestones.notice).toBeLessThan(WAKE_POLICY.noticeAfterMs + 2_000)
      expect(milestones.coldNotice).toBeGreaterThanOrEqual(WAKE_POLICY.longWaitNoticeAfterMs)
      expect(milestones.coldNotice).toBeLessThan(WAKE_POLICY.longWaitNoticeAfterMs + 2_000)
      // The instance answered on its own schedule and an attempt caught it — no
      // button was pressed anywhere in this test.
      //
      // **The bound has two parts, and only the first is a claim.** Boot plus one
      // backoff ceiling is the structural worst case: an attempt refused just
      // before the instance came up sleeps a whole ceiling before the next one
      // (TASK-0118 4.5). With this policy the attempts fall at 87s and 95s, so
      // the instant refusal recovers at 95 — measured 95.2s. The rest is slack
      // for running at full speed.
      expect(milestones.ready).toBeGreaterThanOrEqual(MEASURED_COLD_START_MS)
      expect(milestones.ready).toBeLessThan(
        MEASURED_COLD_START_MS + (WAKE_POLICY.backoffMs.at(-1) ?? 0) + REPLAY_OVERHEAD_MS,
      )
      expect(screen.queryByRole('button', { name: wake.retryLabel })).toBeNull()
    },
  )
})
