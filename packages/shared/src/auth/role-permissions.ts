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
 * `media.upload:own` was absent while a buyer had nothing to upload; return
 * photos (TASK-0067 F2) are that something. A defect return makes a claim the
 * seller pays for, so it has to carry evidence — and a buyer who cannot presign
 * cannot file one at all.
 *
 * **`own` is narrower here than it is for a seller.** A seller's `own` resolves
 * against the store they hold, which is what confines their keys to
 * `products/{sellerId}/…`; a buyer holds no store, so the same scope resolves
 * against their own account and confines their keys to `returns/{userId}/…`.
 * The upload endpoint never takes an owner from the request, so this grant opens
 * exactly one prefix and it is the caller's own (TASK-0067 · `uploads.service.ts`).
 */
const BUYER_GRANTS: readonly PermissionGrant[] = [
  grant('catalog.read', 'any'),
  grant('product.read', 'any'),
  grant('seller.read', 'any'),
  grant('cart.read', 'own'),
  grant('cart.write', 'own'),
  grant('order.read', 'own'),
  grant('order.write', 'own'),
  grant('claim.read', 'own'),
  grant('coupon.read', 'own'),
  // 코드를 넣어 **본인이** 받는다. `coupon.write` 를 줄 수는 없다 — 주면 구매자가
  // 쿠폰을 만들 수 있고, 그것은 스코프로 좁혀지지 않는 능력이다.
  grant('coupon.claim', 'own'),
  grant('media.upload', 'own'),
  // 자기가 산 것에 리뷰를 쓴다 (TASK-0083). 읽기는 퍼미션이 없다 — 리뷰는 로그인하지
  // 않은 사람도 읽는 상품 상세의 일부다.
  grant('review.write', 'own'),
  // 찜 · 최근 본 상품 · 팔로우 (M13).
  grant('collection.write', 'own'),
  // 문의를 남긴다 (TASK-0088). 읽기는 퍼미션이 없다 — 공개 문의는 상품 정보의 일부다.
  grant('question.write', 'own'),
  grant('notification.read', 'own'),
  // 신고한다 (TASK-0091). 처리는 관리자만 한다.
  grant('report.write', 'own'),
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
  grant('coupon.claim', 'own'),
  // 판매자도 물건을 산다 (TASK-0083).
  grant('review.write', 'own'),
  grant('collection.write', 'own'),
  grant('question.write', 'own'),
  // 자기 상품에 달린 문의에 답한다 (TASK-0088).
  grant('question.answer', 'own'),
  grant('notification.read', 'own'),
  grant('report.write', 'own'),
  // 자기 상품에 달린 리뷰에 답한다 (TASK-0085).
  grant('review.reply', 'own'),
  // **`coupon.platform` 은 없다.** 플랫폼 부담 쿠폰은 남의 돈으로 하는 할인이고,
  // 그 거절은 스코프가 아니라 이 빈자리가 만든다 (`permissions.ts`).
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
  // 신고된 리뷰를 가리는 것은 일상 운영이다 (TASK-0091). `DEMO_ADMIN` 은 아래에서
  // `demo` 로 좁혀지고, 그것이 방문자의 관리자가 실계정의 말을 못 지우는 자리다.
  grant('review.moderate', 'any'),
  // 신고된 글을 가리거나 지운다 (TASK-0091). `DEMO_ADMIN` 은 아래에서 `demo` 로
  // 좁혀지고, 그것이 방문자의 관리자가 실계정의 글을 못 지우는 자리다 (D-058).
  grant('content.moderate', 'any'),
  // 판매자가 답하지 못하는 상황에서 운영자가 대신 답한다 — 상품 대리 수정과 같은 축.
  grant('review.reply', 'any'),
  grant('question.answer', 'any'),
  grant('coupon.read', 'any'),
  grant('coupon.write', 'any'),
  // 플랫폼 부담 쿠폰. `DEMO_ADMIN` 은 아래에서 `demo` 로 좁혀지고, 그것이 방문자의
  // 관리자가 **실계정이 쓰는 쿠폰**을 못 만드는 자리다.
  grant('coupon.platform', 'any'),
  grant('settlement.read', 'any'),
  // 읽기만이다. `commission.write` 가 없는 것이 TASK-0079 F7 이고, 데모 관리자가
  // 요율을 못 바꾸는 것도 이 빈자리에서 따라 나온다 — 그쪽은 이 목록을 좁혀 받는다.
  grant('commission.read', 'any'),
  grant('user.read', 'any'),
  grant('seller.read', 'any'),
  grant('seller.approve', 'any'),
  grant('demo.manage', 'any'),
  // 스케줄러가 멈췄을 때 즉시 복구하는 것은 일상 운영이다 (TASK-0051 R1).
  grant('reservation.sweep', 'any'),
  // 관리자도 자기 알림함을 갖는다 (입점 신청 · 신고). `own` 인 것은 이 문이 남의
  // 알림함을 열 방법을 갖고 있지 않기 때문이다 — 넓혀도 닿을 것이 없다.
  grant('notification.read', 'own'),
  grant('report.write', 'own'),
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
