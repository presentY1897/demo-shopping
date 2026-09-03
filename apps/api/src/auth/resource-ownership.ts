import type { ResourceOwnership } from '@shopping/shared'

/**
 * The columns an ownership mapper reads, as a Prisma `select` fragment.
 *
 * Exported so that a service never spells out the demo column itself: it spreads
 * this into its `select` and hands the row to {@link accountOwnership}. That is
 * what makes the grep in TASK-0105 F8 meaningful — `isDemo` appears in this file
 * and nowhere else in `apps/api/src`.
 */
export const accountOwnershipSelect = { id: true, isDemo: true } as const

export interface AccountRow {
  readonly id: string
  readonly isDemo: boolean
}

/**
 * Ownership of a row that *is* an account — a `User`, and anything keyed one to
 * one by it.
 *
 * An account owns itself, which is what makes `own` mean "my own profile" for a
 * buyer, and it carries its own demo flag, which is what makes `demo` mean "an
 * account a visitor was issued" for a demo administrator.
 */
export function accountOwnership(account: AccountRow): ResourceOwnership {
  return { ownerUserId: account.id, ownerSellerId: null, ownerIsDemo: account.isDemo }
}
