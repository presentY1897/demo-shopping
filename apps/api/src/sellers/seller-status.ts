import type { Permission, SellerStatus } from '@shopping/shared'

/**
 * The seller onboarding state machine, as pure logic (TASK-0108 4장).
 *
 * Two tables live here and nothing else: **which move is legal from which
 * state**, and **what a store in a given state is allowed to do**. Neither of
 * them touches a database, a request or a clock, which is what lets both be
 * checked exhaustively — QUALITY-GATES Q5 holds this file to 100% branch
 * coverage, and a branch nothing reaches here is a transition nobody decided
 * about.
 *
 * **Why a table rather than a `switch` in the service.** A status check written
 * where it is needed is written once per place that needs it, and the copies
 * disagree within a release — the symptom being a store that can do something
 * in one endpoint and not in the sibling endpoint next to it. TASK-0105 made
 * the same argument for `assertResourceAccess`, and this is its counterpart for
 * the store's own state.
 *
 * `docs/design/state-machines.md` 6 is the same machine drawn.
 */

/**
 * What can be asked of a store.
 *
 * `apply` is on the list even though it has no source status, because "신청" and
 * "재신청" are the same move — one from nothing, one from `REJECTED` — and
 * splitting them would put the decision "does this account already have a
 * store?" in two places.
 */
export const sellerActions = ['apply', 'approve', 'reject', 'suspend', 'reinstate'] as const

export type SellerAction = (typeof sellerActions)[number]

/**
 * One row of the transition table: where a move may start, and where it lands.
 *
 * `from` holds `null` for "this account has no store yet", which is a real
 * state of the machine even though no row exists to carry it.
 */
interface Transition {
  readonly from: readonly (SellerStatus | null)[]
  readonly to: SellerStatus
}

/**
 * Every legal move, and only those.
 *
 * The re-application arrow (`REJECTED → PENDING`) is the one this task added to
 * `docs/design/state-machines.md`: the original TASK-0026 F4 requires a
 * rejected applicant to be able to fix what was wrong and try again, and a
 * machine without it makes the first rejection permanent.
 *
 * There is no `ACTIVE → REJECTED` and no `SUSPENDED → REJECTED`. Rejection is
 * an answer to an application; ending an approved store's trading is 정지, and
 * the two carry different obligations — a suspended store still has to fulfil
 * the orders it already took (see {@link sellerStatusAllows}).
 */
const TRANSITIONS: Readonly<Record<SellerAction, Transition>> = {
  apply: { from: [null, 'REJECTED'], to: 'PENDING' },
  approve: { from: ['PENDING'], to: 'ACTIVE' },
  reject: { from: ['PENDING'], to: 'REJECTED' },
  suspend: { from: ['ACTIVE'], to: 'SUSPENDED' },
  reinstate: { from: ['SUSPENDED'], to: 'ACTIVE' },
}

/**
 * Where `action` takes a store in `current`, or `null` when it takes it
 * nowhere.
 *
 * `null` is the whole of "정의되지 않은 전이": the caller gets a 400 and the
 * list of moves that *were* available, so a console can say what to do instead
 * of only saying no (F10).
 */
export function nextSellerStatus(
  current: SellerStatus | null,
  action: SellerAction,
): SellerStatus | null {
  const transition = TRANSITIONS[action]

  return transition.from.includes(current) ? transition.to : null
}

/** Every move a store in `current` can make, in a stable order. */
export function allowedSellerActions(current: SellerStatus | null): readonly SellerAction[] {
  return sellerActions.filter((action) => nextSellerStatus(current, action) !== null)
}

/**
 * What a store may be asked to do while it is in a given state.
 *
 * Only two capabilities exist today and both are permissions the seller
 * endpoints of other tasks already require, which is deliberate: the capability
 * a caller passes is the same string that endpoint declares to
 * `@RequirePermission`, so the two cannot describe different actions.
 */
export const sellerCapabilities = ['product.write', 'order.write'] as const

export type SellerCapability = Extract<Permission, (typeof sellerCapabilities)[number]>

/**
 * TASK-0108 4장's table, as code.
 *
 * | 상태 | 상품 등록 | 주문 처리 |
 * | PENDING | ✗ | ✗ |
 * | ACTIVE | ✓ | ✓ |
 * | REJECTED | ✗ | ✗ |
 * | SUSPENDED | ✗ | **✓** |
 *
 * **The one interesting cell is `SUSPENDED × order.write`.** A suspended store
 * has buyers who already paid, and stopping their deliveries punishes the
 * people the suspension was meant to protect. Everything else follows
 * `docs/design/state-machines.md` 6 — "ACTIVE 가 아니면 상품 등록과 판매가
 * 불가능하다".
 *
 * `PENDING` and `REJECTED` have no orders to process at all, which the design
 * document writes as "–" rather than "✗". They are `false` here: a capability
 * table that answered "not applicable" would need a third value and every
 * caller would have to decide what to do with it, when the only safe reading of
 * "there is nothing to process" is "refuse".
 */
const CAPABILITIES: Readonly<Record<SellerStatus, readonly SellerCapability[]>> = {
  PENDING: [],
  ACTIVE: ['product.write', 'order.write'],
  REJECTED: [],
  SUSPENDED: ['order.write'],
}

/** Whether a store in `status` may do `capability`. */
export function sellerStatusAllows(status: SellerStatus, capability: SellerCapability): boolean {
  return CAPABILITIES[status].includes(capability)
}
