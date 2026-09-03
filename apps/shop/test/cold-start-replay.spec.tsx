/**
 * The real thing, at real speed: a 90 second cold start replayed against the
 * production wake-up policy.
 *
 * **Skipped unless asked for.** It takes about a minute and a half, which does
 * not belong in `pnpm test` or in CI. It belongs in the repository because a
 * measurement nobody can repeat is an anecdote:
 *
 * ```bash
 * COLD_START_REPLAY=1 pnpm --filter @shopping/shop test cold-start-replay
 * ```
 *
 * What it reproduces, and why it is not simply a slow response: Render does not
 * reject a request aimed at a sleeping service. It holds the request, starts the
 * instance, and answers everything that arrived in the meantime as soon as the
 * instance is up — so the deadline is shared and a caller that gave up and asked
 * again joins a wait already in progress. `sleepingInstance` models that; a
 * per-request delay would model the opposite and no retry policy could ever pass
 * against it.
 *
 * With `WAKE_POLICY` that produces:
 *
 * | t | what happens |
 * | --- | --- |
 * | 0s | request 1 goes out, spin-up begins, skeleton on screen |
 * | 3s | "서버를 준비하는 중입니다" + elapsed counter + progress bar |
 * | 10s | request 1 hits its deadline; 1s backoff |
 * | 11s | request 2 goes out |
 * | 15s | the notice adds the "최대 2분" line |
 * | 51s | request 2 hits its deadline; 2s backoff |
 * | 53s | request 3 goes out, with a 90s deadline |
 * | 90s | the instance is up and answers request 3 |
 *
 * The assertions below are the record: they bound each milestone tightly enough
 * that the table above cannot drift without this failing.
 */

import { healthOk, mockPaths, sleepingInstance } from '@shopping/api-mocks'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiWakeGate } from '@/components/api-wake-gate'
import { WAKE_POLICY } from '@/lib/wake-policy'
import { messagesFor } from '@/messages'

import { testServer } from './setup'

const { health, wake } = messagesFor()

/** Measured against the deployed API on 2026-09-03 (TASK-0101 4.1). */
const MEASURED_COLD_START_MS = 90_000

const enabled = process.env.COLD_START_REPLAY === '1'

describe.skipIf(!enabled)('a 90 second cold start, at full speed', () => {
  it(
    'keeps the page up, explains the wait in two stages, and recovers by itself',
    { timeout: 180_000 },
    async () => {
      testServer.server.use(sleepingInstance(mockPaths.health, MEASURED_COLD_START_MS, healthOk))

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

      // Recorded run, 2026-09-03 (TASK-0101 6.3):
      //   shell 90ms · notice 3,016ms · coldNotice 15,031ms · ready 91,134ms
      // The bounds below are what keeps that a fact rather than a note.
      expect(milestones.shell).toBeLessThan(1_000)
      expect(milestones.notice).toBeGreaterThanOrEqual(WAKE_POLICY.noticeAfterMs)
      expect(milestones.notice).toBeLessThan(WAKE_POLICY.noticeAfterMs + 2_000)
      expect(milestones.coldNotice).toBeGreaterThanOrEqual(WAKE_POLICY.longWaitNoticeAfterMs)
      expect(milestones.coldNotice).toBeLessThan(WAKE_POLICY.longWaitNoticeAfterMs + 2_000)
      // The instance answered on its own schedule and the third attempt caught
      // it — no button was pressed anywhere in this test.
      expect(milestones.ready).toBeGreaterThanOrEqual(MEASURED_COLD_START_MS)
      expect(milestones.ready).toBeLessThan(MEASURED_COLD_START_MS + 5_000)
      expect(screen.queryByRole('button', { name: wake.retryLabel })).toBeNull()
    },
  )
})
