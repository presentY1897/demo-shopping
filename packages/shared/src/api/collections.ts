import { z } from 'zod'

import { productIdSchema } from './products.js'
import { sellerIdSchema } from './sellers.js'
import { wonSchema } from '../pricing/types.js'

/**
 * 찜 · 최근 본 상품 · 팔로우 (TASK-0086 · 0087 · 0089).
 *
 * 셋 다 「사람이 무엇을 가리킨다」 하나뿐이라 계약도 셋이 닮았다. 한 파일에 두는
 * 이유가 그것이다 — 토글의 답이 서로 다른 모양이면 화면이 세 벌의 낙관적 갱신을
 * 쓰게 된다.
 */

/**
 * 토글의 답.
 *
 * **지금 상태를 돌려준다.** 「눌렀다」가 아니라 「지금 이렇다」여야 낙관적 갱신이
 * 틀렸을 때 되돌릴 값이 답 안에 있다 (TASK-0086 F2).
 */
export const toggleResultSchema = z.object({ active: z.boolean() })

export type ToggleResult = z.infer<typeof toggleResultSchema>

export const WISHLIST_DEFAULT_LIMIT = 20
export const WISHLIST_MAX_LIMIT = 100

/** 찜 목록의 한 줄. */
export const wishlistItemSchema = z.object({
  productId: productIdSchema,
  productName: z.string(),
  brandName: z.string(),
  thumbnailUrl: z.string().nullable(),
  /**
   * 지금의 최저가. **팔 수 있는 조합이 없으면 `null`** 이고, 그때가 품절이다.
   */
  price: wonSchema.nullable(),
  /** 담을 때의 최저가. 없으면 그때도 팔 수 있는 조합이 없었다. */
  addedPrice: wonSchema.nullable(),
  /**
   * 품절인가 (F4).
   *
   * 가격이 없다는 것과 같은 사실이지만 이름을 따로 두는 이유는 **화면이 그리는 것이
   * 다르기** 때문이다 — 가격 자리에는 「—」가 그려지고, 품절 여부는 재입고 알림
   * 버튼을 띄운다.
   */
  soldOut: z.boolean(),
  /**
   * 재입고되면 알려 달라고 신청했는가 (F4).
   *
   * 찜과 나누는 이유는 **두 개의 다른 마음**이기 때문이다 — 담아 두는 것은 「나중에
   * 살까」이고 알림 신청은 「지금 사고 싶은데 없다」다.
   */
  notifyRestock: z.boolean(),
  addedAt: z.iso.datetime(),
})

export type WishlistItem = z.infer<typeof wishlistItemSchema>

export const wishlistQueryParamsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(WISHLIST_MAX_LIMIT).optional(),
})

export type WishlistQueryParams = z.infer<typeof wishlistQueryParamsSchema>

export const wishlistResponseSchema = z.object({
  items: z.array(wishlistItemSchema),
  nextCursor: z.string().nullable(),
})

export type WishlistResponse = z.infer<typeof wishlistResponseSchema>

/**
 * 최근 본 상품이 남는 최대 개수 — 50 (TASK-0087 F5).
 *
 * 상한이 없으면 이 표가 사람마다 무한히 자라고, 그 목록은 아무도 끝까지 보지 않는다.
 */
export const RECENTLY_VIEWED_MAX = 50

export const recentlyViewedItemSchema = z.object({
  productId: productIdSchema,
  productName: z.string(),
  brandName: z.string(),
  thumbnailUrl: z.string().nullable(),
  price: wonSchema.nullable(),
  viewedAt: z.iso.datetime(),
})

export type RecentlyViewedItem = z.infer<typeof recentlyViewedItemSchema>

export const recentlyViewedResponseSchema = z.object({
  items: z.array(recentlyViewedItemSchema),
})

export type RecentlyViewedResponse = z.infer<typeof recentlyViewedResponseSchema>

export const RECENTLY_VIEWED_MERGE_MAX = 50

/**
 * `POST /api/v1/me/recently-viewed` — 비로그인 이력을 합친다 (TASK-0087 F6).
 *
 * **본 시각을 함께 받는다.** 없으면 합친 이력이 전부 지금 본 것이 되어, 로그인
 * 직후의 「최근 본 상품」이 실제 순서를 잃는다.
 *
 * 이미 있는 상품은 **더 최근 쪽이 이긴다** — 브라우저에 남아 있던 옛 기록이 방금 본
 * 것을 뒤로 밀면 안 된다.
 */
export const mergeRecentlyViewedRequestSchema = z.object({
  items: z
    .array(z.object({ productId: productIdSchema, viewedAt: z.iso.datetime() }))
    .min(1)
    .max(RECENTLY_VIEWED_MERGE_MAX),
})

export type MergeRecentlyViewedRequest = z.infer<typeof mergeRecentlyViewedRequestSchema>

export const FOLLOW_LIST_DEFAULT_LIMIT = 20
export const FOLLOW_LIST_MAX_LIMIT = 100

/** 팔로우 목록의 한 줄. */
export const followedSellerSchema = z.object({
  sellerId: sellerIdSchema,
  brandName: z.string(),
  slug: z.string(),
  logoUrl: z.string().nullable(),
  followerCount: z.int().min(0),
  followedAt: z.iso.datetime(),
})

export type FollowedSeller = z.infer<typeof followedSellerSchema>

export const followListQueryParamsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(FOLLOW_LIST_MAX_LIMIT).optional(),
})

export type FollowListQueryParams = z.infer<typeof followListQueryParamsSchema>

export const followListResponseSchema = z.object({
  sellers: z.array(followedSellerSchema),
  nextCursor: z.string().nullable(),
})

export type FollowListResponse = z.infer<typeof followListResponseSchema>

/**
 * 팔로우 토글의 답 — 지금 상태와 **지금 팔로워 수**.
 *
 * 수를 함께 주는 이유는 화면이 그 자리에서 숫자를 그리기 때문이다. 낙관적으로 ±1 을
 * 하면 두 탭에서 누른 사람의 화면이 서로 다른 수를 그리고, 어느 쪽도 맞지 않는다.
 */
export const followResultSchema = z.object({
  active: z.boolean(),
  followerCount: z.int().min(0),
})

export type FollowResult = z.infer<typeof followResultSchema>

/**
 * `POST /api/v1/me/wishlist/:productId/restock-alert` — 재입고 알림 신청을 켜고 끈다.
 *
 * **찜한 것에만 걸 수 있다.** 찜하지 않은 상품에 알림만 거는 길을 열면 「알림은
 * 기다리는데 목록에는 없는」 상태가 생기고, 그것을 끄는 화면이 어디에도 없다.
 *
 * 알림이 나간 뒤에는 서버가 꺼 준다 — 한 번 알린 재입고를 다시 알릴 이유가 없다.
 */
export const restockAlertResultSchema = z.object({ notifyRestock: z.boolean() })

export type RestockAlertResult = z.infer<typeof restockAlertResultSchema>
