/**
 * The mirror, held against the machine it mirrors.
 *
 * `src/lib/sellers/decisions.ts` is the one place this console decides which
 * buttons a row gets, and it is a copy of a table that lives in `apps/api`
 * (TASK-0110 4장). A copy nobody exercises is a copy that drifts, so the
 * expectations below are written out **from `docs/design/state-machines.md` 6장**
 * rather than derived from the module — a test that read the same table it is
 * checking would pass whatever the table said.
 *
 * Held to 100% branch coverage by `vitest.config.mjs`: a branch nothing reaches
 * here is a row offering the wrong buttons, and the symptom is never a red test
 * because the buttons still render.
 */

import type { SellerStatus } from '@shopping/shared'
import { sellerStatuses } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import type { SellerDecision } from '@/lib/sellers/decisions'
import {
  decisionsFor,
  needsReason,
  permissionFor,
  sellerDecisions,
  statusVariant,
} from '@/lib/sellers/decisions'

/** The arrows of `docs/design/state-machines.md` 6장, as an administrator sees them. */
const EXPECTED: Readonly<Record<SellerStatus, readonly SellerDecision[]>> = {
  PENDING: ['approve', 'reject'],
  ACTIVE: ['suspend'],
  SUSPENDED: ['reinstate'],
  // 재신청 is the seller's move, from their own console. An administrator has
  // nothing to do with a rejected application until it comes back.
  REJECTED: [],
}

describe('which decisions a status offers', () => {
  it.each(sellerStatuses)('%s', (status) => {
    expect(decisionsFor(status)).toEqual(EXPECTED[status])
  })

  it('never offers a decision twice', () => {
    for (const status of sellerStatuses) {
      const offered = decisionsFor(status)

      expect(new Set(offered).size).toBe(offered.length)
    }
  })

  it('offers every decision from exactly one status', () => {
    const offered = sellerStatuses.flatMap((status) => decisionsFor(status))

    expect([...offered].sort()).toEqual([...sellerDecisions].sort())
  })
})

describe('which permission decides each one', () => {
  it('gives 승인 and 반려 to the approving officer', () => {
    expect(permissionFor('approve')).toBe('seller.approve')
    expect(permissionFor('reject')).toBe('seller.approve')
  })

  /**
   * The reversal is held to the same permission as the suspension. A lower bar
   * for undoing it would be a way around it (TASK-0108 4장).
   */
  it('keeps 정지 and 해제 together on seller.suspend', () => {
    expect(permissionFor('suspend')).toBe('seller.suspend')
    expect(permissionFor('reinstate')).toBe('seller.suspend')
  })
})

describe('which decisions carry a reason', () => {
  it('requires one exactly where the contract does', () => {
    // `sellerReasonedDecisionRequestSchema` is the body 반려 and 정지 take.
    expect(sellerDecisions.filter((decision) => needsReason(decision))).toEqual([
      'reject',
      'suspend',
    ])
  })
})

describe('the status badge', () => {
  it('gives every status a colour', () => {
    expect(sellerStatuses.map((status) => statusVariant(status))).toEqual([
      'warning',
      'success',
      'neutral',
      'danger',
    ])
  })

  it('marks only the waiting status as work to do', () => {
    const attention = sellerStatuses.filter((status) => statusVariant(status) === 'warning')

    expect(attention).toEqual(['PENDING'])
  })
})
