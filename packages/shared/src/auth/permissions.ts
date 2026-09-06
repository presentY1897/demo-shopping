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
  /**
   * 자기 장바구니 (TASK-0045 4.2).
   *
   * `order.*` 를 재사용하지 않는다. 운영자가 `order.read` 를 `any` 로 갖고 있고,
   * 재사용하면 그것이 곧 「아무의 장바구니나 읽는다」가 된다 — 아무도 요구한 적
   * 없는 사생활 확대다.
   */
  'cart.read',
  'cart.write',
  'order.read',
  'order.write',
  /**
   * 만료 예약 정리를 **손으로** 돌린다 (TASK-0051).
   *
   * `order.write` 를 재사용하지 않는 이유는 스코프다. 구매자와 판매자가 그것을
   * `own` 으로 갖고 있는데, 이 잡은 소유자가 없는 전역 작업이라 `own` 으로 좁힐
   * 대상이 없다 — 재사용하면 「내 것만」이 아무 뜻이 없는 자리에서 통과한다.
   *
   * 손으로 돌릴 수 있어야 하는 이유는 R1 이다: 스케줄러가 멈추면 재고가 잠기고,
   * 그때 사람이 즉시 복구할 방법이 있어야 한다.
   */
  'reservation.sweep',
  'claim.read',
  'claim.handle',
  'coupon.read',
  'coupon.write',
  /**
   * **플랫폼이 부담하는** 쿠폰을 낸다 (TASK-0073 F7).
   *
   * `coupon.write` 와 나뉘어 있는 이유는 스코프로는 표현할 수 없기 때문이다.
   * 판매자 쿠폰의 소유자는 그 스토어라 `own` 이 뜻을 갖지만, 플랫폼 쿠폰에는
   * **소유하는 스토어가 없다.** 만들어질 행의 소유자를 「만드는 사람」으로 두면
   * 판매자의 `coupon.write:own` 이 자기 계정에 걸려 통과하고, 그 순간 판매자가
   * 플랫폼 부담 쿠폰을 낼 수 있게 된다 — 남의 돈으로 할인하는 일이다.
   *
   * 그래서 **등급을 나눈다.** 이 권한이 없으면 플랫폼 쿠폰은 만들 수 없고, 있으면
   * 스코프가 「어느 그룹에 낼 수 있는가」를 정한다: `any` 는 실계정이 쓰는 쿠폰까지,
   * `demo` 는 자기가 데모일 때 데모 그룹에만. 그것이 데모 관리자가 발행 화면을
   * 읽기 전용 껍데기로 만나지 않으면서도 실계정에 닿는 쿠폰을 못 만드는 자리다.
   */
  'coupon.platform',
  /**
   * 코드를 넣어 **본인이** 받는다 (TASK-0072 · TASK-0073).
   *
   * 한동안 이 문은 `coupon.read` 를 쓰고 있었다. 넓어서가 아니라 **이름과 행동이
   * 달라서** 부채였다 — 구매자에게 `coupon.write` 를 줄 수는 없고(주면 구매자가
   * 쿠폰을 만들 수 있다) 그 목록을 소유하지 않은 TASK 가 새 이름을 더할 수도
   * 없어서, 「받는다」가 「읽는다」로 적혀 있었다.
   *
   * 스코프는 언제나 `own` 이다. 이 라우트는 `userId` 를 요청에서 받지 않으므로
   * 「남의 쿠폰함에 넣는다」가 표현 불가능하고, `any` 를 준다 해도 넓힐 것이 없다.
   */
  'coupon.claim',
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
