import type { Permission } from './permissions.js'
import { isReadPermission, permissions } from './permissions.js'
import type { Role } from './roles.js'
import type { ResourceScope } from './resource-scope.js'

/** One permission a role holds, together with the rows it reaches. */
export interface PermissionGrant {
  readonly permission: Permission
  readonly scope: ResourceScope
}

function grant(permission: Permission, scope: ResourceScope): PermissionGrant {
  return { permission, scope }
}

/**
 * A buyer.
 *
 * The catalogue is shared by everyone (DECISIONS 2 — "상품 카탈로그는 공용"), so
 * reading it is `any`; everything personal is `own` and needs no other guard.
 *
 * **`user.write` is deliberately absent.** In this table it means administering
 * an account — which includes granting roles — so a `user.write:own` here would
 * let any buyer hand themselves `ADMIN_SUPER` and pass the scope check while
 * doing it, because the account they are editing really is their own. Editing
 * one's own profile is a different capability and gets its own permission when
 * TASK-0027 builds that screen.
 *
 * `media.upload` is absent for the same kind of reason: a buyer has nothing to
 * upload until review photos exist (M13). Granting it now would open a write
 * path into the bucket that no screen uses and no test covers.
 */
const BUYER_GRANTS: readonly PermissionGrant[] = [
  grant('catalog.read', 'any'),
  grant('product.read', 'any'),
  grant('seller.read', 'any'),
  grant('order.read', 'own'),
  grant('order.write', 'own'),
  grant('claim.read', 'own'),
  grant('coupon.read', 'own'),
  grant('user.read', 'own'),
  grant('profile.write', 'own'),
  grant('profile.delete', 'own'),
  // Applying to sell is done by somebody who is not a seller yet, so the
  // ability has to sit here rather than on `SELLER_OWNER` (TASK-0108).
  grant('seller.write', 'own'),
]

/**
 * A seller who owns one store.
 *
 * Named `SELLER_OWNER` rather than `SELLER` to leave room for staff accounts
 * under the same store later (TASK-0105 2 — out of scope for now).
 *
 * `catalog.read` is `any` because a seller has to pick a category from the
 * platform's tree; everything else is `own` and is resolved against the store
 * they own, not against their user id.
 *
 * `media.upload:own` is what lets a seller ask for a presigned URL, and the
 * scope is what confines the key it gets to their own store's prefix — the
 * upload endpoint resolves it against the `Seller` row, not against the id in
 * the request (TASK-0011 4.4).
 */
const SELLER_OWNER_GRANTS: readonly PermissionGrant[] = [
  grant('catalog.read', 'any'),
  grant('product.read', 'own'),
  grant('product.write', 'own'),
  grant('product.delete', 'own'),
  grant('media.upload', 'own'),
  grant('order.read', 'own'),
  grant('order.write', 'own'),
  grant('claim.read', 'own'),
  grant('claim.handle', 'own'),
  grant('coupon.read', 'own'),
  grant('coupon.write', 'own'),
  grant('coupon.delete', 'own'),
  grant('settlement.read', 'own'),
  grant('seller.read', 'own'),
  grant('seller.write', 'own'),
  grant('user.read', 'own'),
  grant('profile.write', 'own'),
  grant('profile.delete', 'own'),
]

/**
 * The everyday site operator: everything readable, a limited set writable.
 *
 * No `delete`, no `settlement.approve`/`settlement.pay`, no `user.write`, no
 * `seller.suspend` — the irreversible and the money-moving actions belong to
 * `ADMIN_SUPER` (TASK-0105 4).
 *
 * `media.upload` is `any` because an operator replaces a store's images when a
 * seller cannot; `DEMO_ADMIN` inherits it narrowed to `demo` below, which is
 * what keeps a visitor's administrator out of a real store's bucket prefix.
 */
const ADMIN_OPERATOR_GRANTS: readonly PermissionGrant[] = [
  grant('catalog.read', 'any'),
  grant('catalog.write', 'any'),
  grant('product.read', 'any'),
  grant('product.write', 'any'),
  grant('media.upload', 'any'),
  grant('order.read', 'any'),
  grant('claim.read', 'any'),
  grant('claim.handle', 'any'),
  grant('coupon.read', 'any'),
  grant('coupon.write', 'any'),
  grant('settlement.read', 'any'),
  grant('user.read', 'any'),
  grant('seller.read', 'any'),
  grant('seller.approve', 'any'),
  grant('demo.manage', 'any'),
]

/** The owner of the platform. Everything, everywhere. */
const ADMIN_SUPER_GRANTS: readonly PermissionGrant[] = permissions.map((permission) =>
  grant(permission, 'any'),
)

/**
 * `DEMO_ADMIN` is `ADMIN_OPERATOR` with its reach narrowed, and is *derived*
 * from it rather than written out again.
 *
 * DECISIONS 2 states the rule as an equation — "`DEMO_ADMIN` = `ADMIN_OPERATOR`
 * + 스코프 `demo`" — and a second hand-maintained list would let the two drift
 * the first time an operator gains a permission and nobody remembers this one.
 *
 * Reading stays `any` (`docs/design/erd.md` 1 — "시드·실계정 데이터는 조회만"):
 * a demo administrator sees the whole platform and can only change what a demo
 * account created. A grant that is already `own` is left alone — it is narrower
 * than `demo`, not wider.
 */
function narrowToDemo(entry: PermissionGrant): PermissionGrant {
  if (entry.scope !== 'any') return entry
  return isReadPermission(entry.permission) ? entry : grant(entry.permission, 'demo')
}

const DEMO_ADMIN_GRANTS: readonly PermissionGrant[] = ADMIN_OPERATOR_GRANTS.map(narrowToDemo)

/**
 * The whole authorization table, as a code constant.
 *
 * Not a database table on purpose (`schema.prisma`, `enum Role`): permissions
 * change with a deploy and a review, never with an `UPDATE` nobody sees. The
 * rendered version lives in `docs/design/permission-matrix.md` and is generated
 * from this object, so the documentation cannot describe a system that is not
 * running.
 */
export const rolePermissions: Readonly<Record<Role, readonly PermissionGrant[]>> = {
  BUYER: BUYER_GRANTS,
  SELLER_OWNER: SELLER_OWNER_GRANTS,
  ADMIN_OPERATOR: ADMIN_OPERATOR_GRANTS,
  ADMIN_SUPER: ADMIN_SUPER_GRANTS,
  DEMO_ADMIN: DEMO_ADMIN_GRANTS,
}
