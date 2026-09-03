import type { Permission } from './permissions.js'
import type { PermissionGrant } from './role-permissions.js'
import { rolePermissions } from './role-permissions.js'
import type { ResourceOwnership, ResourceScope } from './resource-scope.js'
import { resourceScopes } from './resource-scope.js'
import type { Role } from './roles.js'

/**
 * The caller, reduced to what a permission decision actually needs.
 *
 * Note what is *not* here: whether the caller is a demo account. It never enters
 * the decision. A demo administrator is limited because they hold `DEMO_ADMIN`,
 * whose grants carry the `demo` scope — not because a flag on the request said
 * so. That is what keeps `isDemo` out of the services (TASK-0105 3).
 *
 * `apps/api` extends this into `RequestPrincipal`; a front-end permission hook
 * (TASK-0023) can build one from the session and call the same functions.
 */
export interface AuthorizationSubject {
  readonly userId: string
  readonly roles: readonly Role[]
  /** The store this account owns, if any. `own` resolves against it. */
  readonly sellerId: string | null
}

/** Why a request was refused, in terms a UI can turn into a reason. */
export const denialReasons = ['missing_permission', 'out_of_scope'] as const

export type DenialReason = (typeof denialReasons)[number]

export type AccessDecision =
  | { readonly allowed: true; readonly scopes: readonly ResourceScope[] }
  | { readonly allowed: false; readonly reason: DenialReason }

function grantsOf(role: Role): readonly PermissionGrant[] {
  return rolePermissions[role]
}

/**
 * Every scope the subject holds for one permission, in `own → demo → any` order.
 *
 * A list rather than a single "widest" scope because roles combine and the
 * scopes do not form a chain: someone who is both a seller and a demo
 * administrator holds `product.write` on their own store *and* on demo-created
 * rows, and neither of those contains the other.
 *
 * An empty list is the deny-by-default answer — an unknown role or a permission
 * nobody was granted both come out the same way.
 */
export function grantedScopes(
  subject: AuthorizationSubject,
  permission: Permission,
): readonly ResourceScope[] {
  const held = new Set<ResourceScope>()

  for (const role of subject.roles) {
    for (const entry of grantsOf(role)) {
      if (entry.permission === permission) held.add(entry.scope)
    }
  }

  return resourceScopes.filter((scope) => held.has(scope))
}

/** Whether the subject holds the permission at all, at any scope. */
export function canPerform(subject: AuthorizationSubject, permission: Permission): boolean {
  return grantedScopes(subject, permission).length > 0
}

/**
 * Whether the subject owns the row.
 *
 * Either link counts: a product belongs to a store, an order belongs to a
 * person, and the same seller account is both. The explicit `null` checks are
 * what stops platform data — owned by nobody — from matching a caller who has no
 * store either, which a plain `===` between two `null`s would happily do.
 */
function owns(subject: AuthorizationSubject, resource: ResourceOwnership): boolean {
  const bySeller = resource.ownerSellerId !== null && resource.ownerSellerId === subject.sellerId
  const byUser = resource.ownerUserId !== null && resource.ownerUserId === subject.userId

  return bySeller || byUser
}

/** Whether one scope reaches one row. The whole of the "누구 것에" question. */
export function scopeAdmits(
  scope: ResourceScope,
  subject: AuthorizationSubject,
  resource: ResourceOwnership,
): boolean {
  switch (scope) {
    case 'any':
      return true
    case 'own':
      return owns(subject, resource)
    case 'demo':
      // Seed rows and real accounts both report `false` here, which is the
      // entire mechanism protecting them from a demo administrator.
      return resource.ownerIsDemo
  }
}

/**
 * Decides a permission on its own, for endpoints that name no single row —
 * a listing, or a create that has nothing to be checked against yet.
 *
 * Passing this is not enough for a subject whose only grant is narrow: the
 * handler still has to call {@link authorizeResource} once it knows which rows
 * are involved. The returned scopes are what tells it whether that is needed.
 */
export function authorizePermission(
  subject: AuthorizationSubject,
  permission: Permission,
): AccessDecision {
  const scopes = grantedScopes(subject, permission)

  return scopes.length > 0
    ? { allowed: true, scopes }
    : { allowed: false, reason: 'missing_permission' }
}

/**
 * Decides a permission against one row.
 *
 * The two refusals are kept apart because they mean different things to the
 * caller: `missing_permission` is "this role never does that", `out_of_scope` is
 * "this role does that, but not to this row".
 */
export function authorizeResource(
  subject: AuthorizationSubject,
  permission: Permission,
  resource: ResourceOwnership,
): AccessDecision {
  const scopes = grantedScopes(subject, permission)
  if (scopes.length === 0) return { allowed: false, reason: 'missing_permission' }

  const admitting = scopes.filter((scope) => scopeAdmits(scope, subject, resource))

  return admitting.length > 0
    ? { allowed: true, scopes: admitting }
    : { allowed: false, reason: 'out_of_scope' }
}

/** Convenience wrapper for call sites that only need a yes or no. */
export function canAccessResource(
  subject: AuthorizationSubject,
  permission: Permission,
  resource: ResourceOwnership,
): boolean {
  return authorizeResource(subject, permission, resource).allowed
}
