/**
 * F6 — every member of `HealthFailureReason` has copy of its own.
 *
 * `timeout` and `aborted` are here rather than in the page spec on purpose
 * (4.7): reproducing them through a real round trip means waiting out a five
 * second deadline, and the panel takes its result as a prop, so the state can
 * be made as a value. The mapping from a transport failure to those two reasons
 * is covered by `packages/shared`'s client spec.
 */

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { HealthPanel } from '@/components/health-panel'
import type { HealthFailureReason } from '@/lib/health'
import { messagesFor } from '@/messages'

const { health } = messagesFor()

const REASONS: readonly HealthFailureReason[] = [
  'network',
  'timeout',
  'aborted',
  'http',
  'malformed_response',
  'configuration',
  'unknown',
]

describe('every failure reason', () => {
  it.each(REASONS)('%s is announced with its own copy', (reason) => {
    render(<HealthPanel messages={health} result={{ ok: false, endpoint: 'x', reason }} />)

    const alert = screen.getByRole('alert')

    expect(within(alert).getByText(health.failureTitle)).toBeVisible()
    expect(within(alert).getByText(health.failures[reason])).toBeVisible()
  })

  it('has no two reasons sharing a sentence', () => {
    const copy = REASONS.map((reason) => health.failures[reason])

    expect(new Set(copy).size).toBe(REASONS.length)
  })
})
