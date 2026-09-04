import type { SellerStatus } from '@shopping/shared'
import { sellerStatuses } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import type { SellerAction } from './seller-status.js'
import {
  allowedSellerActions,
  nextSellerStatus,
  sellerActions,
  sellerCapabilities,
  sellerStatusAllows,
} from './seller-status.js'

/**
 * The state machine, checked as a table rather than case by case.
 *
 * QUALITY-GATES Q5 holds this module to 100% branch coverage, and the way to
 * earn that honestly is to enumerate the **whole** cross product — every
 * status, including "no store yet", against every action — and state which
 * cells are legal. A spec written as a list of the transitions somebody
 * remembered would reach the same coverage while saying nothing about the ones
 * they forgot, which are precisely the cells a state machine goes wrong in.
 */

/** Every state a store can be in, plus the one it is in before it exists. */
const STATES: readonly (SellerStatus | null)[] = [null, ...sellerStatuses]

/** The transitions TASK-0108 4장 draws. Everything absent here must be refused. */
const LEGAL = new Map<string, SellerStatus>([
  ['null:apply', 'PENDING'],
  ['REJECTED:apply', 'PENDING'],
  ['PENDING:approve', 'ACTIVE'],
  ['PENDING:reject', 'REJECTED'],
  ['ACTIVE:suspend', 'SUSPENDED'],
  ['SUSPENDED:reinstate', 'ACTIVE'],
])

function key(state: SellerStatus | null, action: SellerAction): string {
  return `${state ?? 'null'}:${action}`
}

describe('nextSellerStatus — 전이표 전수', () => {
  it('answers exactly the six transitions the design draws, and refuses the other fourteen', () => {
    const legal: string[] = []
    const refused: string[] = []

    for (const state of STATES) {
      for (const action of sellerActions) {
        const target = nextSellerStatus(state, action)

        if (target === null) {
          refused.push(key(state, action))
          continue
        }

        legal.push(key(state, action))
        expect(target).toBe(LEGAL.get(key(state, action)))
      }
    }

    expect([...legal].sort()).toEqual([...LEGAL.keys()].sort())
    // Five states × five actions, minus the six that are legal.
    expect(refused).toHaveLength(STATES.length * sellerActions.length - LEGAL.size)
  })

  it('lets a rejected applicant apply again', () => {
    // The arrow this task added to `docs/design/state-machines.md`. Without it
    // the first rejection is permanent and TASK-0026 F4 cannot be satisfied.
    expect(nextSellerStatus('REJECTED', 'apply')).toBe('PENDING')
  })

  it('refuses the transition 완료 기준 F10 names', () => {
    expect(nextSellerStatus('REJECTED', 'suspend')).toBeNull()
  })

  it('never lets an approved or suspended store be rejected', () => {
    // Rejection answers an application. Ending an approved store's trading is
    // 정지, and it carries obligations rejection does not.
    expect(nextSellerStatus('ACTIVE', 'reject')).toBeNull()
    expect(nextSellerStatus('SUSPENDED', 'reject')).toBeNull()
  })

  it('never lets a store be applied for twice', () => {
    expect(nextSellerStatus('PENDING', 'apply')).toBeNull()
    expect(nextSellerStatus('ACTIVE', 'apply')).toBeNull()
    expect(nextSellerStatus('SUSPENDED', 'apply')).toBeNull()
  })
})

describe('allowedSellerActions — 거절과 함께 돌려주는 안내', () => {
  it('names what each state can do next', () => {
    expect(allowedSellerActions(null)).toEqual(['apply'])
    expect(allowedSellerActions('PENDING')).toEqual(['approve', 'reject'])
    expect(allowedSellerActions('ACTIVE')).toEqual(['suspend'])
    expect(allowedSellerActions('REJECTED')).toEqual(['apply'])
    expect(allowedSellerActions('SUSPENDED')).toEqual(['reinstate'])
  })

  it('agrees with the transition table for every state', () => {
    for (const state of STATES) {
      const listed = allowedSellerActions(state)
      const derived = sellerActions.filter((action) => nextSellerStatus(state, action) !== null)

      expect(listed).toEqual(derived)
    }
  })
})

describe('sellerStatusAllows — 상태별 접근 제어표', () => {
  it('answers every cell of the four-by-two table', () => {
    const table = STATES.filter((state): state is SellerStatus => state !== null).map((status) => ({
      status,
      product: sellerStatusAllows(status, 'product.write'),
      order: sellerStatusAllows(status, 'order.write'),
    }))

    expect(table).toEqual([
      { status: 'PENDING', product: false, order: false },
      { status: 'ACTIVE', product: true, order: true },
      { status: 'REJECTED', product: false, order: false },
      // The cell the table exists for: a suspended seller still owes deliveries
      // to buyers who already paid.
      { status: 'SUSPENDED', product: false, order: true },
    ])
  })

  it('lets only ACTIVE add to the catalogue', () => {
    const allowed = sellerStatuses.filter((status) => sellerStatusAllows(status, 'product.write'))

    expect(allowed).toEqual(['ACTIVE'])
  })

  it('covers every capability for every status', () => {
    // A capability added without a decision for each status would otherwise
    // silently answer `false` everywhere — a permission nothing grants and
    // nothing reports.
    for (const status of sellerStatuses) {
      for (const capability of sellerCapabilities) {
        expect(typeof sellerStatusAllows(status, capability)).toBe('boolean')
      }
    }
  })
})
