/**
 * Which rows a grant reaches. The other half of a permission (TASK-0105 4).
 *
 * - `own`  — rows the caller owns: their own account, their own store's data
 * - `demo` — rows a demo account created, whoever that demo account was
 * - `any`  — every row
 *
 * `demo` exists so that the demo restriction is a value in the permission table
 * rather than an `if (user.isDemo)` scattered through the services. Its purpose
 * is protecting real accounts, not isolating demo accounts from each other: a
 * demo administrator must be able to approve a demo seller's application, or the
 * admin console is a read-only shell for every visitor who tries it.
 */
export const resourceScopes = ['own', 'demo', 'any'] as const

export type ResourceScope = (typeof resourceScopes)[number]

/**
 * Who a row belongs to, in the only terms the authorization layer understands.
 *
 * Every table that is subject to a scope check gets one small mapper producing
 * this (`apps/api/src/auth/resource-ownership.ts`), and the services below it
 * never look at an owner or at a demo flag themselves.
 *
 * - `ownerUserId`   — the account that owns the row, `null` for platform data
 * - `ownerSellerId` — the store that owns the row, `null` when no store does
 * - `ownerIsDemo`   — whether the owning account is a demo account; `false` for
 *   seed and platform data, which is exactly what keeps it out of `demo` reach
 */
export interface ResourceOwnership {
  readonly ownerUserId: string | null
  readonly ownerSellerId: string | null
  readonly ownerIsDemo: boolean
}

/**
 * Seed rows, categories, and anything else the platform itself owns.
 *
 * Not owned by any account and not demo-created, so `own` and `demo` both refuse
 * it and only an `any` grant gets through.
 */
export const platformOwnership: ResourceOwnership = {
  ownerUserId: null,
  ownerSellerId: null,
  ownerIsDemo: false,
}
