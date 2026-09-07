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
  /**
   * 수수료율을 읽는다 (TASK-0079).
   *
   * `settlement.read` 와 나눈 이유는 **읽는 대상이 다르기** 때문이다. 저쪽은
   * 「내가 얼마 받나」이고 이쪽은 「플랫폼이 몇 퍼센트를 떼나」인데, 정산서를 보는
   * 판매자에게 남의 가게 요율까지 딸려 가면 개별 계약이 새어 나간다.
   */
  'commission.read',
  /**
   * 수수료율을 바꾼다 (TASK-0079 F7).
   *
   * **`ADMIN_SUPER` 만 갖는다.** 이 권한이 목록에 더해지는 것만으로 그렇게 되는데,
   * 최고 관리자의 권한이 「전부」로 쓰여 있고 운영자의 것은 하나씩 적혀 있기
   * 때문이다 (`role-permissions.ts`). 데모 관리자가 요율을 못 바꾸는 것도 여기서
   * 따라 나온다 — 그쪽은 운영자에서 파생되므로 애초에 이 이름을 갖지 않는다.
   *
   * 요율은 **모든 판매자의 다음 정산 금액**을 한 번에 옮기는 값이라, 되돌릴 수
   * 있다는 것이 위험을 줄여 주지 않는다. 이미 팔린 것에는 주문 시점 요율이 박혀
   * 있어 소급되지 않지만(F4), 잘못 바꾼 채 하루가 지나면 그날 판 것 전부가 잘못된
   * 요율로 굳는다.
   */
  'commission.write',
  /**
   * 정산 배치를 **손으로 한 번 돌린다** (TASK-0080).
   *
   * `reservation.sweep` 과 같은 종류의 이름이다 — 스케줄러가 멈췄을 때 즉시 복구하는
   * 문이고, 그 문이 자기 퍼미션을 갖는 이유는 재사용할 만한 것이 없기 때문이다.
   *
   * 다만 **`ADMIN_SUPER` 만 갖는다.** 예약 청소와 달리 이 배치는 「누가 얼마를
   * 받는가」의 초안을 만들고, 그 초안이 곧 지급의 근거가 된다. 자동으로 도는 잡이라
   * 이 문이 필요한 것은 드문 복구뿐이고, 드문 일에 넓은 권한을 열어 둘 이유가 없다.
   */
  'settlement.run',
  /**
   * **자기가 산 것에** 리뷰를 쓴다 (TASK-0083).
   *
   * 스코프가 언제나 `own` 인 것은 이 문이 남의 리뷰를 만들 방법을 갖고 있지 않기
   * 때문이다 — 요청이 가리키는 것은 주문 항목이고, 남의 주문 항목은 애초에 이
   * 사람의 것이 아니다. `any` 를 준다 해도 넓힐 것이 없다.
   *
   * 읽기가 없는 것도 같은 이유다. **리뷰는 로그인하지 않은 사람도 읽는다** — 상품
   * 상세의 일부이고, 퍼미션으로 가리면 그 화면이 로그인 벽 뒤로 들어간다.
   */
  'review.write',
  /**
   * 남의 리뷰를 가리거나 되살린다 (TASK-0091).
   *
   * `review.write` 와 나눈 이유는 **하는 일이 다르기** 때문이다. 저쪽은 자기 말을
   * 남기는 일이고 이쪽은 **남의 말을 지우는 일**이라, 한 이름으로 묶으면 리뷰를 쓸
   * 수 있는 모든 사람이 남의 리뷰를 가릴 수 있게 된다.
   */
  /**
   * **자기 상품에 달린 리뷰에** 답한다 (TASK-0085).
   *
   * `review.write` 와 나눈 이유는 자격의 출처가 다르기 때문이다 — 저쪽은 「내가
   * 샀다」에서 나오고 이쪽은 「내가 판다」에서 나온다. 스코프가 `own` 인 것도 그
   * 스토어를 가리키는 것이지 그 리뷰를 가리키는 것이 아니다.
   */
  /**
   * 찜 · 최근 본 상품 · 팔로우 (TASK-0086 · 0087 · 0089).
   *
   * 셋을 한 이름으로 묶은 이유는 **셋 다 자기 목록 하나뿐**이기 때문이다. 나누면
   * 이름이 셋 늘어나는데 그 셋이 서로 다른 조합으로 주어질 일이 없다 — 찜은 되고
   * 팔로우는 안 되는 계정은 이 제품에 존재하지 않는다.
   *
   * 스코프는 언제나 `own` 이다. 이 문들은 사용자 id 를 받지 않으므로 「남의 목록에
   * 담는다」가 표현 불가능하고, `any` 를 준다 해도 넓힐 것이 없다.
   */
  'collection.write',
  /**
   * **자기 상품에 달린 문의에** 답한다 (TASK-0088).
   *
   * `review.reply` 와 나누지 않고 하나로 묶는 길도 있었지만, 그러면 리뷰에 답할 수
   * 있는 사람이 문의에도 답할 수 있게 된다 — 지금은 같은 사람이지만 그 둘이 갈리는
   * 날(고객 응대 담당과 상품 담당) 나눌 자리가 없어진다.
   */
  'question.answer',
  /**
   * 문의를 남긴다 (TASK-0088).
   *
   * 읽기가 없는 것은 **공개 문의가 상품 정보의 일부**이기 때문이다. 비공개 문의를
   * 가리는 것은 퍼미션이 아니라 질의의 조건이 한다 — 퍼미션은 「이 사람이 이런 일을
   * 할 수 있는가」를 말하지 「이 행이 이 사람에게 보이는가」를 말하지 못한다.
   */
  'question.write',
  'review.reply',
  'review.moderate',
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
