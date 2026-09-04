import type { SellerStatus } from '@shopping/shared'

/**
 * The one place this app compares a store's status to a value.
 *
 * TASK-0109 4장 asks for `sellerStatusSchema` to be the only source of these
 * values, and everything else on the screen honours that by being **keyed** by
 * the union — the banner copy, the badge variant, the tinted surface — so a
 * status added to the contract fails `pnpm typecheck` rather than rendering as a
 * blank. This is the one branch that cannot be a lookup, because it is not about
 * a status at all: it is about which endpoint the submit button calls.
 */

/**
 * Where `POST /sellers/applications` may be called from.
 *
 * The same row as `TRANSITIONS.apply` in `apps/api/src/sellers/seller-status.ts`
 * — `from: [null, 'REJECTED']` — and the same reason it is one row rather than
 * two: 신청 and 재신청 are one move, one from nothing and one from a rejection,
 * and splitting them puts "does this account already have a store?" in two
 * places. The API is still the judge; this only decides which request the form
 * sends and what the button says, and a wrong guess comes back as the 400 that
 * names `status`.
 */
const APPLY_FROM: readonly (SellerStatus | null)[] = [null, 'REJECTED']

/** True when the submit is an application rather than an edit. */
export function canApply(status: SellerStatus | null): boolean {
  return APPLY_FROM.includes(status)
}
