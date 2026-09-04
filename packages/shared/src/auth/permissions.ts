/**
 * Everything the API can be asked to do, as `<resource>.<action>` pairs.
 *
 * A permission answers "what may be done", never "to whose data" — that half of
 * the question belongs to {@link ResourceScope} and is deliberately kept out of
 * the name. `product.write` is one permission, not three, and the difference
 * between a seller editing their own catalogue and an operator editing anyone's
 * is a scope on the grant rather than a second permission.
 *
 * The list is closed on purpose. Adding one is a code change that also changes
 * the generated matrix in `docs/design/permission-matrix.md`, which is the point:
 * nobody widens the surface without it showing up in a diff.
 */
export const permissions = [
  'catalog.read',
  'catalog.write',
  'catalog.delete',
  'product.read',
  'product.write',
  'product.delete',
  // No `media.read` or `media.delete` counterpart, on purpose: an uploaded
  // object is read through a public URL that asks for no permission at all, and
  // removing one follows from deleting the row that references it rather than
  // being a capability a role holds. `upload` is the whole surface (TASK-0011).
  'media.upload',
  'order.read',
  'order.write',
  'claim.read',
  'claim.handle',
  'coupon.read',
  'coupon.write',
  'coupon.delete',
  'settlement.read',
  'settlement.approve',
  'settlement.pay',
  'user.read',
  'user.write',
  'user.delete',
  /**
   * Editing **one's own** account — profile, preferences, addresses.
   *
   * Separate from `user.write`, which TASK-0105 gave to `ADMIN_SUPER` alone so
   * that operating on somebody else's account stays a rare capability. Reusing
   * it here would have handed every buyer the admin's ability (TASK-0111).
   */
  'profile.write',
  /**
   * Closing one's own account.
   *
   * Split from `profile.write` because it cannot be undone: a future role meant
   * to allow only "change display density" would otherwise carry the ability to
   * delete the account with it (TASK-0111).
   */
  'profile.delete',
  'seller.read',
  /**
   * Applying to sell, and editing one's own store.
   *
   * `BUYER` holds it too — **applying is done by somebody who is not a seller
   * yet** — and the `own` scope is what keeps that from reaching another store
   * (TASK-0108).
   */
  'seller.write',
  'seller.approve',
  'seller.suspend',
  'demo.manage',
] as const

export type Permission = (typeof permissions)[number]

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (permissions as readonly string[]).includes(value)
}

/** The resource half of a permission: `product` for `product.write`. */
export function permissionResource(permission: Permission): string {
  return permission.slice(0, permission.indexOf('.'))
}

/** The action half of a permission: `write` for `product.write`. */
export function permissionAction(permission: Permission): string {
  return permission.slice(permission.indexOf('.') + 1)
}

/**
 * Whether a permission can only ever observe.
 *
 * This is what lets a demo administrator keep looking at the whole platform
 * while only being able to change demo-owned rows: narrowing a grant to the
 * `demo` scope applies to the mutating half of a role and leaves reading alone
 * (`docs/design/erd.md` 1 — "시드·실계정 데이터는 조회만"). Deriving it from the
 * action instead of a second hand-kept list means a new `*.read` permission is
 * covered the day it is added.
 */
export function isReadPermission(permission: Permission): boolean {
  return permissionAction(permission) === 'read'
}
