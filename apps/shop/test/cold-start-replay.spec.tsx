/**
 * Optional replay of a 90-second cold start using the production retry policy.
 * Run with COLD_START_REPLAY=1. The storefront shows a brief notice after 3s
 * and removes it once search is ready; technical counters remain internal.
 */

import { healthOk, mockPaths, sleepingInstance } from '@shopping/api-mocks'
import { render, screen, waitForElementToBeRemoved } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiWakeGate } from '@/components/api-wake-gate'
import { WAKE_POLICY } from '@/lib/wake-policy'
import { messagesFor } from '@/messages'

import { testServer } from './setup'

const { wake } = messagesFor()

/** Measured against the deployed API on 2026-09-03 (TASK-0101 4.1). */
const MEASURED_COLD_START_MS = 90_000

const enabled = process.env.COLD_START_REPLAY === '1'

describe.skipIf(!enabled)('a 90 second cold start, at full speed', () => {
  it(
    'keeps the page up, briefly explains the wait, and recovers by itself',
    { timeout: 180_000 },
    async () => {
      testServer.server.use(sleepingInstance(mockPaths.health, MEASURED_COLD_START_MS, healthOk))

      const startedAt = performance.now()
      const at = (): number => Math.round(performance.now() - startedAt)
      const milestones: Record<string, number> = {}

      render(<ApiWakeGate policy={WAKE_POLICY} wake={wake} />)

      // The page is up from the first frame — nothing waited on the API.
      expect(screen.queryByText(wake.storefrontPreparing)).toBeNull()
      milestones.shell = at()

      await screen.findByText(wake.storefrontPreparing, undefined, { timeout: 10_000 })
      milestones.notice = at()

      await waitForElementToBeRemoved(() => screen.queryByText(wake.storefrontPreparing), {
        timeout: 150_000,
      })
      milestones.ready = at()

      // Preserve the production timing contract while simplifying the visible copy.
      expect(milestones.shell).toBeLessThan(1_000)
      expect(milestones.notice).toBeGreaterThanOrEqual(WAKE_POLICY.noticeAfterMs)
      expect(milestones.notice).toBeLessThan(WAKE_POLICY.noticeAfterMs + 2_000)
      // The instance answered on its own schedule and the third attempt caught
      // it — no button was pressed anywhere in this test.
      expect(milestones.ready).toBeGreaterThanOrEqual(MEASURED_COLD_START_MS)
      expect(milestones.ready).toBeLessThan(MEASURED_COLD_START_MS + 5_000)
      expect(screen.queryByRole('button', { name: wake.retryLabel })).toBeNull()
    },
  )
})
