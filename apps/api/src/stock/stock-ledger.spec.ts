import { stockLedgerTypes } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import type { MovementDraft } from './stock-ledger.js'
import {
  movementIssues,
  nextBalance,
  reconciliationFaults,
  stockDirections,
} from './stock-ledger.js'

/**
 * The ledger's rules, exhausted (QUALITY-GATES Q5 — 순수 로직, 분기 100%).
 *
 * Every refusal here is also a constraint in the migration, and
 * `test/db/stock-constraints.spec.ts` tries the same cases against the real
 * database. Both halves are needed: the database is what makes the rule true
 * for a psql session, and this is what makes the refusal name a field.
 */

function draft(overrides: Partial<MovementDraft> = {}): MovementDraft {
  return { type: 'INBOUND', quantity: 5, refType: null, refId: null, reason: null, ...overrides }
}

function codes(input: Partial<MovementDraft>): readonly string[] {
  return movementIssues(draft(input)).map((issue) => issue.code)
}

describe('stockDirections', () => {
  it('decides a direction for every declared type', () => {
    // A record rather than a switch precisely so that this holds by compilation;
    // asserting it as well is what catches a type added with a wrong direction.
    for (const type of stockLedgerTypes) {
      expect(stockDirections[type]).toMatch(/^(in|out|either)$/)
    }
  })

  it('lets only ADJUST move both ways', () => {
    const twoWay = stockLedgerTypes.filter((type) => stockDirections[type] === 'either')

    expect(twoWay).toEqual(['ADJUST'])
  })
})

describe('movementIssues — 부호', () => {
  it('accepts a movement that agrees with its type', () => {
    expect(codes({ type: 'INBOUND', quantity: 5 })).toEqual([])
    expect(codes({ type: 'SALE', quantity: -2 })).toEqual([])
    expect(codes({ type: 'ADJUST', quantity: 3, reason: '실사 차이' })).toEqual([])
    expect(codes({ type: 'ADJUST', quantity: -3, reason: '파손' })).toEqual([])
  })

  it('refuses a quantity of zero whatever the type', () => {
    expect(codes({ type: 'INBOUND', quantity: 0 })).toEqual(['zero_quantity'])
    expect(codes({ type: 'ADJUST', quantity: 0, reason: '실사' })).toEqual(['zero_quantity'])
  })

  it('refuses a sign the type does not allow', () => {
    // A SALE that adds stock is not a correctable mistake: it is a row that
    // makes every reader of the ledger wrong.
    expect(codes({ type: 'SALE', quantity: 2 })).toEqual(['wrong_direction'])
    expect(codes({ type: 'RESERVE_CONFIRM', quantity: 1 })).toEqual(['wrong_direction'])
    expect(codes({ type: 'INBOUND', quantity: -1 })).toEqual(['wrong_direction'])
    expect(codes({ type: 'CANCEL', quantity: -1 })).toEqual(['wrong_direction'])
    expect(codes({ type: 'RETURN_IN', quantity: -1 })).toEqual(['wrong_direction'])
  })

  it('names the quantity, so a form can put the message under it', () => {
    expect(movementIssues(draft({ type: 'SALE', quantity: 2 }))).toEqual([
      { code: 'wrong_direction', field: 'quantity' },
    ])
  })
})

describe('movementIssues — 참조', () => {
  it('accepts both halves and neither', () => {
    expect(codes({ refType: null, refId: null })).toEqual([])
    expect(codes({ refType: 'ORDER_ITEM', refId: '0192f0c1-0000-7000-8000-00000000ab01' })).toEqual(
      [],
    )
  })

  it('refuses half a reference, naming the missing half', () => {
    expect(movementIssues(draft({ refType: 'ORDER_ITEM', refId: null }))).toEqual([
      { code: 'unpaired_reference', field: 'refId' },
    ])
    expect(
      movementIssues(draft({ refType: null, refId: '0192f0c1-0000-7000-8000-00000000ab01' })),
    ).toEqual([{ code: 'unpaired_reference', field: 'refType' }])
  })
})

describe('movementIssues — 사유', () => {
  it('requires one for an adjustment and for nothing else', () => {
    expect(codes({ type: 'ADJUST', quantity: 3, reason: null })).toEqual(['reason_required'])
    expect(codes({ type: 'INBOUND', quantity: 3, reason: null })).toEqual([])
  })

  it('refuses whitespace, whatever the type', () => {
    expect(codes({ type: 'ADJUST', quantity: 3, reason: '   ' })).toEqual(['blank_reason'])
    expect(codes({ type: 'INBOUND', quantity: 3, reason: '\t\n' })).toEqual(['blank_reason'])
  })

  it('reports every problem at once', () => {
    // A caller filling a form should not have to submit three times to be told
    // three things.
    expect(
      codes({ type: 'ADJUST', quantity: 0, refType: 'ORDER_ITEM', refId: null, reason: null }),
    ).toEqual(['zero_quantity', 'unpaired_reference', 'reason_required'])
  })
})

describe('nextBalance', () => {
  it('adds the movement', () => {
    expect(nextBalance(10, 5)).toBe(15)
    expect(nextBalance(10, -4)).toBe(6)
    expect(nextBalance(1, -1)).toBe(0)
  })

  it('refuses a result below zero', () => {
    expect(nextBalance(1, -2)).toBeNull()
    expect(nextBalance(0, -1)).toBeNull()
  })
})

describe('reconciliationFaults', () => {
  const sound = { stock: 7, entries: 3, sum: 7, lastBalanceAfter: 7, maxSeq: 3, chainBreaks: 0 }

  it('finds nothing wrong with a ledger that explains its stock', () => {
    expect(reconciliationFaults(sound)).toEqual([])
  })

  it('finds nothing wrong with a variant that never moved', () => {
    expect(
      reconciliationFaults({
        stock: 0,
        entries: 0,
        sum: 0,
        lastBalanceAfter: 0,
        maxSeq: 0,
        chainBreaks: 0,
      }),
    ).toEqual([])
  })

  it('reports a stock the movements do not add up to (L1)', () => {
    // The shape a lost update leaves behind: two decrements recorded, one
    // applied. No row looks wrong on its own.
    expect(reconciliationFaults({ ...sound, sum: 8 })).toEqual(['sum_mismatch'])
  })

  it('reports a broken balance chain (L2)', () => {
    expect(reconciliationFaults({ ...sound, chainBreaks: 2 })).toEqual(['chain_break'])
  })

  it('reports a newest balance that is not the current stock (L3)', () => {
    expect(reconciliationFaults({ ...sound, lastBalanceAfter: 6 })).toEqual(['endpoint_mismatch'])
  })

  it('reports a gap in the positions (L4)', () => {
    // A gap means a row was removed or written without the lock that hands out
    // `seq` — the two ways a movement escapes the ledger entirely.
    expect(reconciliationFaults({ ...sound, maxSeq: 4 })).toEqual(['seq_gap'])
  })

  it('reports every broken statement, not the first', () => {
    expect(
      reconciliationFaults({
        stock: 7,
        entries: 2,
        sum: 9,
        lastBalanceAfter: 9,
        maxSeq: 3,
        chainBreaks: 1,
      }),
    ).toEqual(['sum_mismatch', 'chain_break', 'endpoint_mismatch', 'seq_gap'])
  })
})
