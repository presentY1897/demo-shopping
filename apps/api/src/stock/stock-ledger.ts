import type { StockLedgerType, StockReconciliationFault, StockRefType } from '@shopping/shared'

/**
 * The rules of the stock ledger, as pure functions.
 *
 * Three questions live here and none of them needs a database.
 *
 * **May this movement be recorded?** A quantity of zero is not a movement, the
 * sign has to agree with the type, a reference is both halves or neither, and
 * an adjustment owes a reason. Every one of these is also a constraint in the
 * migration; what this file adds is an answer that names the input, because a
 * constraint name is not something a form can put under a field
 * (`docs/design/error-contract.md` 1).
 *
 * **What is the stock afterwards?** Addition, with one refusal — the result may
 * not be negative. The refusal is here rather than in the service so that it is
 * decided by a function with no way to read a stale value.
 *
 * **Does the ledger still explain the stock?** TASK-0036 4.1 turns "현재값은
 * 원장의 결과이며 대사가 가능해야 한다" into four statements, and
 * {@link reconciliationFaults} says which of them a variant breaks. Which one
 * matters: "합계가 다르다" alone does not say whether a row was lost, written
 * outside the lock, or written with the wrong balance.
 *
 * No I/O, so every branch is reachable from a unit test and the gate on this
 * file is branch coverage 100% (QUALITY-GATES Q5 — 순수 로직).
 */

/** Which way a type of movement may take the stock. */
export type StockDirection = 'in' | 'out' | 'either'

/**
 * The direction each type implies, as a total record.
 *
 * A record rather than a `switch`: adding a type to `@shopping/shared` without
 * deciding its direction stops compiling, which is the only way a new movement
 * cannot arrive with no rule at all. `StockLedger_direction_check` states the
 * same table to the database.
 */
export const stockDirections: Readonly<Record<StockLedgerType, StockDirection>> = {
  INBOUND: 'in',
  CANCEL: 'in',
  RETURN_IN: 'in',
  SALE: 'out',
  RESERVE_CONFIRM: 'out',
  // The only two-way movement, and therefore the only one obliged to say why.
  ADJUST: 'either',
}

export type MovementIssueCode =
  /** A movement of nothing. */
  | 'zero_quantity'
  /** The sign disagrees with the type — a `SALE` that adds stock. */
  | 'wrong_direction'
  /** One half of a reference without the other. */
  | 'unpaired_reference'
  /** An `ADJUST` with no reason. */
  | 'reason_required'
  /** A reason made of whitespace. */
  | 'blank_reason'

/**
 * One refusal, with the input it is about.
 *
 * A field name rather than a sentence, because the caller turns it into a
 * `details[].field` and the form on the other side puts the message under the
 * control the person actually touched.
 */
export interface MovementIssue {
  readonly code: MovementIssueCode
  readonly field: 'quantity' | 'refType' | 'refId' | 'reason'
}

/** A movement as the service has normalised it: every optional resolved. */
export interface MovementDraft {
  readonly type: StockLedgerType
  readonly quantity: number
  readonly refType: StockRefType | null
  readonly refId: string | null
  readonly reason: string | null
}

/** Whether a quantity moves the way a direction allows. */
function admits(direction: StockDirection, quantity: number): boolean {
  if (direction === 'either') return true

  return direction === 'in' ? quantity > 0 : quantity < 0
}

/**
 * Everything wrong with a movement, or an empty list.
 *
 * All of them at once rather than the first: a caller filling a form should not
 * have to submit four times to be told four things.
 */
export function movementIssues(draft: MovementDraft): readonly MovementIssue[] {
  const issues: MovementIssue[] = []

  if (draft.quantity === 0) {
    issues.push({ code: 'zero_quantity', field: 'quantity' })
  } else if (!admits(stockDirections[draft.type], draft.quantity)) {
    issues.push({ code: 'wrong_direction', field: 'quantity' })
  }

  // Half a reference can neither be followed nor used as an idempotency key,
  // and the partial unique index keys on `refId` — so a row carrying only a
  // `refType` would silently opt out of the rule it looks like it is in.
  if ((draft.refType === null) !== (draft.refId === null)) {
    issues.push({
      code: 'unpaired_reference',
      field: draft.refId === null ? 'refId' : 'refType',
    })
  }

  if (draft.reason !== null && draft.reason.trim() === '') {
    issues.push({ code: 'blank_reason', field: 'reason' })
  } else if (draft.reason === null && draft.type === 'ADJUST') {
    issues.push({ code: 'reason_required', field: 'reason' })
  }

  return issues
}

/**
 * The stock after `quantity` is applied, or `null` when that would be negative.
 *
 * `null` rather than a throw: the caller is inside a transaction holding a row
 * lock and has to decide what to do with the refusal, and a function that
 * cannot fail is a function a test can exhaust.
 */
export function nextBalance(current: number, quantity: number): number | null {
  const balance = current + quantity

  return balance < 0 ? null : balance
}

/**
 * What a reconciliation reads about one variant.
 *
 * The four numbers are all aggregates, which is exactly why none of the rules
 * below can be a CHECK (TASK-0036 4.12).
 */
export interface LedgerAudit {
  /** `ProductVariant.stock` — the current value. */
  readonly stock: number
  /** How many movements the ledger holds for it. */
  readonly entries: number
  /** Sum of every movement's quantity. */
  readonly sum: number
  /** `balanceAfter` of the newest movement; `0` when there are none. */
  readonly lastBalanceAfter: number
  /** Largest `seq`; `0` when there are none. */
  readonly maxSeq: number
  /** Rows whose `balanceAfter` is not the previous one plus their quantity. */
  readonly chainBreaks: number
}

/**
 * Which of TASK-0036 4.1's four statements this variant breaks.
 *
 * An empty list is a variant whose stock the ledger fully explains — including
 * a variant with no movements at all, whose stock must then be zero.
 */
export function reconciliationFaults(audit: LedgerAudit): readonly StockReconciliationFault[] {
  const faults: StockReconciliationFault[] = []

  // L1. The one everybody expects, and the one a lost update breaks.
  if (audit.stock !== audit.sum) faults.push('sum_mismatch')
  // L2. Without it `balanceAfter` is decoration, and storing it is pointless.
  if (audit.chainBreaks > 0) faults.push('chain_break')
  // L3. "재고가 지금 얼마인가"를 원장의 마지막 행만 읽고 답할 수 있는가.
  if (audit.stock !== audit.lastBalanceAfter) faults.push('endpoint_mismatch')
  // L4. A gap means a row was removed, or written without the row lock that
  // hands out `seq` — the two ways a movement escapes the ledger entirely.
  if (audit.maxSeq !== audit.entries) faults.push('seq_gap')

  return faults
}
