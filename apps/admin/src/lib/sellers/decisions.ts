import type { Permission, SellerStatus } from '@shopping/shared'
import type { BadgeVariant } from '@shopping/ui/components'

/**
 * What a review screen may offer for a store in a given state, and who may do it.
 *
 * **This file is a mirror, and saying so is the point.** The transition table it
 * reflects is `apps/api/src/sellers/seller-status.ts` (`TRANSITIONS`), drawn in
 * `docs/design/state-machines.md` 6장. That module is inside `apps/api`, so a
 * browser cannot import it — TASK-0108 4장 asked for the transition judgment to
 * be a pure function but did not say where it should live, and this screen is
 * its second consumer. Moving it to `packages/shared` would delete this half of
 * the file; that package is TASK-0108's (TASK-0110 4장 · 9장).
 *
 * **What a drift costs, so the risk is stated rather than assumed.** If the two
 * disagree, the worst case is a button that looks alive and is answered with a
 * 400 — and that 400 carries `params.allowed`, the moves that *were* possible
 * (TASK-0108 F10), which this console renders. It cannot produce a wrong write:
 * the server decides, always.
 *
 * Nothing here reaches the network or React, so QUALITY-GATES 순수 로직 applies
 * — the vitest config holds it to 100% branch coverage. A branch nothing reaches
 * is a row of the queue offering the wrong buttons, and the symptom is never a
 * red test, because the buttons still render.
 */

/** The four decisions an administrator makes about an application. */
export const sellerDecisions = ['approve', 'reject', 'suspend', 'reinstate'] as const

export type SellerDecision = (typeof sellerDecisions)[number]

/**
 * Where each decision may start.
 *
 * `apply` is absent: re-applying is the seller's move, from their own console
 * (TASK-0109), and an administrator never makes it.
 */
const DECIDABLE_FROM: Readonly<Record<SellerDecision, SellerStatus>> = {
  approve: 'PENDING',
  reject: 'PENDING',
  suspend: 'ACTIVE',
  reinstate: 'SUSPENDED',
}

/**
 * Which permission decides each one (TASK-0108 4장).
 *
 * 정지 and 해제 are held to the same permission on purpose: a lower bar for
 * undoing a suspension would be a way around the suspension.
 */
const DECISION_PERMISSION: Readonly<Record<SellerDecision, Permission>> = {
  approve: 'seller.approve',
  reject: 'seller.approve',
  suspend: 'seller.suspend',
  reinstate: 'seller.suspend',
}

/**
 * The two decisions the seller has to be able to act on, and which therefore
 * carry a reason.
 *
 * The rule itself is the contract's — `sellerReasonedDecisionRequestSchema`
 * makes `reason` required — and this is the same fact stated where a dialog can
 * read it before it renders a field.
 */
const REASONED: readonly SellerDecision[] = ['reject', 'suspend']

/** What a store in `status` can be asked to do here, in a stable order. */
export function decisionsFor(status: SellerStatus): readonly SellerDecision[] {
  return sellerDecisions.filter((decision) => DECIDABLE_FROM[decision] === status)
}

export function permissionFor(decision: SellerDecision): Permission {
  return DECISION_PERMISSION[decision]
}

export function needsReason(decision: SellerDecision): boolean {
  return REASONED.includes(decision)
}

/**
 * The colour a status is shown in.
 *
 * `PENDING` is `warning` rather than `neutral` because it is the only status
 * that is a **request for work**: a queue whose waiting rows look the same as
 * its settled ones is a queue nobody skims successfully.
 */
export function statusVariant(status: SellerStatus): BadgeVariant {
  switch (status) {
    case 'PENDING':
      return 'warning'
    case 'ACTIVE':
      return 'success'
    case 'REJECTED':
      return 'neutral'
    case 'SUSPENDED':
      return 'danger'
  }
}
