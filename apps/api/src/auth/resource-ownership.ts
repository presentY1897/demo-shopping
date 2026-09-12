import { Prisma } from '@prisma/client'

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

/**
 * The columns a store's ownership mapper reads.
 *
 * The demo flag comes from the owning account rather than from the store: a
 * store has no such column, and it is the account a visitor was issued that
 * makes everything under it demo-owned.
 */
export const sellerOwnershipSelect = {
  id: true,
  userId: true,
  user: { select: { isDemo: true } },
} as const

export interface SellerRow {
  readonly id: string
  readonly userId: string
  readonly user: { readonly isDemo: boolean }
}

/**
 * Ownership of a row that belongs to a **store**.
 *
 * Both links are filled in, because both are true and each is what a different
 * grant resolves against: a seller reaches it through `ownerSellerId` (their
 * `sellerId`), and an operator acting on behalf of the owning account reaches
 * the same row through `ownerUserId`.
 */
export function sellerOwnership(seller: SellerRow): ResourceOwnership {
  return {
    ownerUserId: seller.userId,
    ownerSellerId: seller.id,
    ownerIsDemo: seller.user.isDemo,
  }
}

/**
 * The columns a coupon's ownership mapper reads — **three scalars, no joins**.
 *
 * It was `seller` and `issuedBy` as relations for one afternoon, and that cost
 * three extra statements on every code claim: Prisma loads each relation with a
 * query of its own, and the claim path is what a campaign hammers
 * (`coupon-performance.spec.ts` A5). `Coupon.audience` exists so this question
 * has a scalar answer.
 */
export const couponOwnershipSelect = {
  sellerId: true,
  issuedByUserId: true,
  audience: true,
} as const

export interface CouponRow {
  readonly sellerId: string | null
  readonly issuedByUserId: string | null
  readonly audience: 'ALL' | 'DEMO'
}

/**
 * Ownership of a **coupon policy** (TASK-0073).
 *
 * 세 칸이 세 질문에 각각 답한다.
 *
 * - `sellerId` — 판매자 쿠폰이면 그 스토어의 것이다. 판매자의 `own` 이 여기에 닿는다.
 * - `issuedByUserId` — 플랫폼 쿠폰에는 소유하는 스토어가 없으므로 **발행자가
 *   주인**이다. `NULL` 인 행은 이 칸이 생기기 전에 만들어진 것이고, 주인 없는
 *   플랫폼 데이터로 읽혀 `any` 만 지나간다 — 그때까지의 동작 그대로다.
 * - `audience` — 어느 그룹의 것인가. 발행 시점에 「만든 사람이 데모이거나 대상
 *   스토어가 데모」로 정해지고, 그 뒤로는 조인 없이 이 칸이 답한다.
 */
export function couponOwnership(coupon: CouponRow): ResourceOwnership {
  return {
    ownerUserId: coupon.issuedByUserId,
    ownerSellerId: coupon.sellerId,
    ownerIsDemo: coupon.audience === 'DEMO',
  }
}

/**
 * 이 주인이 속한 그룹 — 그리고 그 그룹의 행이 갈 수 있는 곳.
 *
 * 발행이 이것으로 새 행의 그룹을 정한다. 만드는 쪽이 깃발을 직접 읽지 않아도 되게
 * 하는 것이 이 함수의 전부이고, 그래서 여기 있다(`demo-containment.spec.ts`).
 */
export function ownerGroup(owner: ResourceOwnership): 'ALL' | 'DEMO' {
  return owner.ownerIsDemo ? 'DEMO' : 'ALL'
}

/**
 * 이 계정이 그 행과 **같은 그룹**인가 — 데모가 만든 것은 데모에게만.
 *
 * 스코프 검사와 다른 질문이다. 저것은 「부르는 사람이 이 행을 건드려도 되는가」이고
 * 이것은 「이 행이 **저 사람에게 가도 되는가**」다 — 받는 쪽은 아무 권한도 들고
 * 있지 않으므로 `assertResourceAccess` 로 물을 수 없다.
 *
 * 쿠폰 발급이 그 자리다. 데모 관리자가 낸 플랫폼 쿠폰이 실계정에 발급되면 그것은
 * 방문자가 만든 할인이 진짜 주문에 붙는 일이고, 코드가 붙어 있으면 **누구에게나
 * 퍼질 수 있다.** 반대 방향은 막지 않는다: 진짜 쿠폰을 데모 계정이 받는 것은
 * 방문자가 진짜 흐름을 겪는 일이고, 그 주문 자체가 데모 데이터다.
 *
 * 이 파일에 있는 이유는 여기가 **깃발을 읽어도 되는 유일한 자리**이기 때문이다
 * (`demo-containment.spec.ts`). 부르는 쪽은 깃발을 모른 채 이 질문만 한다.
 */
export function withinDemoGroup(owner: ResourceOwnership, account: AccountRow): boolean {
  return !owner.ownerIsDemo || account.isDemo
}

/**
 * 이 그룹의 행을 **받을 수 있는 계정**의 조건 — Prisma `where` 조각.
 *
 * {@link withinDemoGroup} 이 한 사람을 두고 답하는 질문을, 여러 사람을 뽑을 때
 * 쓰는 모양으로 옮긴 것이다. 일괄 발급이 그 자리다: 거절할 사람을 뽑아 놓고
 * 거절하는 대신, 대상 조회가 처음부터 조건을 달고 나간다.
 *
 * 여기 있는 이유도 같다 — **깃발의 이름을 아는 자리는 이 파일 하나**이고
 * (`demo-containment.spec.ts`), 부르는 쪽은 그룹만 말한다.
 */
export function accountFilterFor(group: 'ALL' | 'DEMO'): { readonly isDemo?: true } {
  return group === 'DEMO' ? { isDemo: true } : {}
}

/** A bounded SQL ownership predicate, so catalogue queries never read the flag themselves. */
export function sellerDemoOwnershipSql(sellerId: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "Seller" scope_seller JOIN "User" scope_owner ON scope_owner."id" = scope_seller."userId"
     WHERE scope_seller."id" = ${sellerId} AND scope_owner."isDemo" = true
  )`
}
