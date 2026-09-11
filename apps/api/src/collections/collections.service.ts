import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type {
  FollowIdsResponse,
  FollowListQueryParams,
  FollowListResponse,
  FollowResult,
  MergeRecentlyViewedRequest,
  RecentlyViewedResponse,
  ToggleResult,
  WishlistIdsResponse,
  WishlistQueryParams,
  WishlistResponse,
} from '@shopping/shared'
import {
  FOLLOW_LIST_DEFAULT_LIMIT,
  RECENTLY_VIEWED_MAX,
  WISHLIST_DEFAULT_LIMIT,
} from '@shopping/shared'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'

/**
 * 찜 · 최근 본 상품 · 팔로우 (TASK-0086 · 0087 · 0089).
 *
 * 셋을 한 서비스에 두는 이유는 **같은 모양의 일**이기 때문이다 — 사람이 무엇을
 * 가리키고, 그 가리킴을 켜고 끄고, 목록으로 읽는다. 셋으로 나누면 토글의 규칙이
 * 세 벌이 되고, 세 벌은 갈라진다.
 *
 * ## 토글은 「지금 상태」를 돌려준다
 *
 * 「눌렀다」가 아니라 「지금 이렇다」여야 낙관적 갱신이 틀렸을 때 되돌릴 값이 답 안에
 * 있다 (TASK-0086 F2). 그리고 두 번 눌러도 답이 같으므로, 네트워크가 느려 두 번
 * 눌린 요청이 상태를 뒤집지 않는다.
 */
@Injectable()
export class CollectionsService {
  private readonly log = new Logger(CollectionsService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * 찜을 켜고 끈다 (F1).
   *
   * 담을 때의 최저가를 함께 적는다 — **지금 값만 알면 「내렸다」를 말할 수 없다**
   * (F5). 뺐다가 다시 담으면 그때의 값으로 새로 적힌다: 기준은 「마지막으로 담은
   * 시점」이지 「처음 관심을 가진 시점」이 아니다.
   */
  async toggleWishlist(userId: string, productId: string): Promise<ToggleResult> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { minPrice: true, deletedAt: true },
    })

    if (product?.deletedAt !== null) throw new NotFoundException('상품을 찾을 수 없어요.')

    const removed = await this.prisma.wishlist.deleteMany({ where: { userId, productId } })

    if (removed.count > 0) return { active: false }

    await this.prisma.wishlist.create({
      data: { userId, productId, addedPrice: product.minPrice, createdAt: this.clock.now() },
    })

    return { active: true }
  }

  /** 내 찜 목록 (F3 · F4 · F5). */
  /**
   * 찜한 상품 id 전부 (TASK-0086 F1).
   *
   * ## 페이지가 없다
   *
   * 목록과 달리 자르지 않는다. 자르는 순간 「여기 없다」가 「찜하지 않았다」를 뜻하지
   * 못하게 되고, 그러면 이 문이 존재하는 이유가 사라진다 — 화면은 다시 「모른다」를
   * 그려야 하고 하트는 빈 채로 남는다.
   *
   * ## 자르지 않아도 되는 이유
   *
   * 줄 하나가 uuid 하나다. 찜 1,000개가 36KB 남짓이고, 같은 1,000개를 목록으로
   * 받으면 이름·브랜드·썸네일 주소·가격 넷이 더 붙어 그 수십 배가 된다. **무게는
   * 줄 수가 아니라 줄 폭이 만든다.**
   *
   * 그래도 사람이 담을 수 있는 수에는 위가 없으므로, 언젠가 위가 필요해지면 그때
   * 필요한 것은 페이지가 아니라 **상한**이다 (찜 자체의 최대 개수) — 페이지를 붙이면
   * 위의 문제가 다시 돌아온다.
   */
  async wishlistIds(userId: string): Promise<WishlistIdsResponse> {
    const rows = await this.prisma.wishlist.findMany({
      where: { userId },
      select: { productId: true },
      orderBy: { createdAt: 'desc' },
    })

    return { productIds: rows.map((row) => row.productId) }
  }

  async wishlist(userId: string, params: WishlistQueryParams): Promise<WishlistResponse> {
    const limit = params.limit ?? WISHLIST_DEFAULT_LIMIT
    const rows = await this.prisma.$queryRaw<WishlistRow[]>`
      SELECT p."id"::text     AS "productId",
             p."name"         AS "productName",
             s."brandName"    AS "brandName",
             pi."url"         AS "thumbnailUrl",
             p."minPrice"     AS "price",
             w."addedPrice"   AS "addedPrice",
             w."notifyRestock" AS "notifyRestock",
             w."createdAt"    AS "addedAt"
        FROM "Wishlist" w
        JOIN "Product" p ON p."id" = w."productId"
        JOIN "Seller" s  ON s."id" = p."sellerId"
        LEFT JOIN LATERAL (
          SELECT COALESCE("thumbnailUrl", "url") AS "url" FROM "ProductImage"
           WHERE "productId" = p."id" ORDER BY "sortOrder" LIMIT 1) pi ON TRUE
       WHERE w."userId" = ${userId}::uuid
         AND (${params.cursor ?? null}::timestamp IS NULL
              OR w."createdAt" < ${params.cursor ?? null}::timestamp)
       ORDER BY w."createdAt" DESC
       LIMIT ${limit + 1}`
    const page = rows.slice(0, limit)

    return {
      items: page.map((row) => ({
        productId: row.productId,
        productName: row.productName,
        brandName: row.brandName,
        thumbnailUrl: row.thumbnailUrl,
        price: row.price,
        addedPrice: row.addedPrice,
        // 팔 수 있는 조합이 하나도 없으면 품절이다 — `minPrice` 가 비어 있다는 것과
        // 같은 사실이지만, 화면이 그리는 것이 다르다 (가격 자리의 「—」와 재입고
        // 알림 버튼).
        soldOut: row.price === null,
        notifyRestock: row.notifyRestock,
        addedAt: row.addedAt.toISOString(),
      })),
      nextCursor: rows.length > limit ? (page.at(-1)?.addedAt.toISOString() ?? null) : null,
    }
  }

  /**
   * 본 것을 적는다 (TASK-0087 F1 · F2 · F4).
   *
   * **던지지 않는다.** 상품 상세가 기록 때문에 실패하면 안 된다 — 사람이 보려던
   * 것은 상품이고, 이력은 곁다리다. 실패는 로그에만 남는다.
   *
   * 같은 상품을 열 번 봐도 행은 하나다: 열쇠가 `(사람, 상품)`이라 두 번째 기록은
   * 시각만 고친다.
   */
  async recordView(userId: string, productId: string): Promise<void> {
    const now = this.clock.now()

    try {
      await this.prisma.recentlyViewed.upsert({
        where: { userId_productId: { userId, productId } },
        create: { userId, productId, viewedAt: now },
        update: { viewedAt: now },
      })
      await this.prune(userId)
    } catch (error) {
      this.log.warn(`최근 본 상품을 적지 못했습니다: ${productId}`, error)
    }
  }

  /**
   * 재입고 알림 신청을 켜고 끈다 (TASK-0086 F4).
   *
   * **찜한 것에만 걸 수 있다.** 찜하지 않은 상품에 알림만 거는 길을 열면 「알림은
   * 기다리는데 목록에는 없는」 상태가 생기고, 그것을 끄는 화면이 어디에도 없다.
   */
  async setRestockAlert(
    userId: string,
    productId: string,
    on: boolean,
  ): Promise<{ notifyRestock: boolean }> {
    const changed = await this.prisma.wishlist.updateMany({
      where: { userId, productId },
      data: { notifyRestock: on },
    })

    if (changed.count === 0) throw new NotFoundException('찜한 상품이 아니에요.')

    return { notifyRestock: on }
  }

  /** 최근 본 상품 (F5 — 최대 개수까지만). */
  async recentlyViewed(userId: string): Promise<RecentlyViewedResponse> {
    const rows = await this.prisma.$queryRaw<RecentRow[]>`
      SELECT p."id"::text  AS "productId",
             p."name"      AS "productName",
             s."brandName" AS "brandName",
             pi."url"      AS "thumbnailUrl",
             p."minPrice"  AS "price",
             rv."viewedAt" AS "viewedAt"
        FROM "RecentlyViewed" rv
        JOIN "Product" p ON p."id" = rv."productId"
        JOIN "Seller" s  ON s."id" = p."sellerId"
        LEFT JOIN LATERAL (
          SELECT COALESCE("thumbnailUrl", "url") AS "url" FROM "ProductImage"
           WHERE "productId" = p."id" ORDER BY "sortOrder" LIMIT 1) pi ON TRUE
       WHERE rv."userId" = ${userId}::uuid
       ORDER BY rv."viewedAt" DESC
       LIMIT ${RECENTLY_VIEWED_MAX}`

    return {
      items: rows.map((row) => ({
        productId: row.productId,
        productName: row.productName,
        brandName: row.brandName,
        thumbnailUrl: row.thumbnailUrl,
        price: row.price,
        viewedAt: row.viewedAt.toISOString(),
      })),
    }
  }

  /**
   * 비로그인 이력을 합친다 (F6).
   *
   * **더 최근 쪽이 이긴다** — 브라우저에 남아 있던 옛 기록이 방금 본 것을 뒤로 밀면
   * 안 된다. `GREATEST` 가 그것을 한 문장으로 만든다.
   *
   * 없는 상품이 섞여 있어도 통째로 실패하지 않는다. 브라우저에 오래 남아 있던
   * 이력에는 그 사이 지워진 상품이 있을 수 있고, 그것 때문에 병합 전체가 실패하면
   * 그 사람의 이력은 영영 합쳐지지 않는다.
   */
  async mergeRecentlyViewed(
    userId: string,
    request: MergeRecentlyViewedRequest,
  ): Promise<RecentlyViewedResponse> {
    const productIds = request.items.map((item) => item.productId)
    const viewedAts = request.items.map((item) => new Date(item.viewedAt))

    await this.prisma.$executeRaw`
      INSERT INTO "RecentlyViewed" ("userId", "productId", "viewedAt")
      SELECT ${userId}::uuid, t.id, t.seen
        FROM unnest(${productIds}::uuid[], ${viewedAts}::timestamp[]) AS t(id, seen)
        JOIN "Product" p ON p."id" = t.id
      ON CONFLICT ("userId", "productId")
      DO UPDATE SET "viewedAt" = GREATEST("RecentlyViewed"."viewedAt", EXCLUDED."viewedAt")`
    await this.prune(userId)

    return this.recentlyViewed(userId)
  }

  /** 하나를 지운다. 없던 것을 지워도 아무 일이 없다 — 결과가 같기 때문이다. */
  async forgetView(userId: string, productId: string): Promise<void> {
    await this.prisma.recentlyViewed.deleteMany({ where: { userId, productId } })
  }

  /** 전부 지운다 (F7). */
  async forgetAllViews(userId: string): Promise<void> {
    await this.prisma.recentlyViewed.deleteMany({ where: { userId } })
  }

  /**
   * 팔로우를 켜고 끈다 (TASK-0089 F1 · F2 · F3).
   *
   * 팔로워 수를 **다시 세지 않고 ±1 한다.** 파생값을 누적하지 않는 원칙과 어긋나
   * 보이지만, 여기서는 세는 대상이 그 자리에서 하나만 바뀌고 그 사실을 이 트랜잭션이
   * 독점한다 — 조건부 삽입·삭제가 0줄을 답하면 아무것도 더하지 않으므로, 두 번 눌린
   * 요청이 두 번 세어지지 않는다. 어긋남의 마지막 방어선은
   * `Seller_followerCount_check` 다.
   */
  async toggleFollow(userId: string, sellerId: string): Promise<FollowResult> {
    const seller = await this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true },
    })

    if (seller === null) throw new NotFoundException('판매자를 찾을 수 없어요.')

    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.sellerFollow.deleteMany({ where: { userId, sellerId } })

      if (removed.count > 0) {
        const after = await tx.seller.update({
          where: { id: sellerId },
          data: { followerCount: { decrement: 1 } },
          select: { followerCount: true },
        })

        return { active: false, followerCount: after.followerCount }
      }

      await tx.sellerFollow.create({ data: { userId, sellerId, createdAt: this.clock.now() } })

      const after = await tx.seller.update({
        where: { id: sellerId },
        data: { followerCount: { increment: 1 } },
        select: { followerCount: true },
      })

      return { active: true, followerCount: after.followerCount }
    })
  }

  /** 내가 팔로우한 브랜드. */
  /**
   * 팔로우한 가게 id 전부, **최근 순** (TASK-0089 F1 · F6).
   *
   * 순서가 계약의 일부다: 홈의 신상품 줄은 이 목록을 앞에서부터
   * `SEARCH_SELLER_IDS_MAX` 개만 쓰므로, 순서가 없으면 50개를 넘겨 팔로우한 사람의
   * 줄이 **새로고침할 때마다 다른 가게로** 채워진다. 최근에 팔로우한 쪽을 남기는
   * 것은 그 사람이 방금 관심을 보인 가게이기 때문이다.
   */
  async followIds(userId: string): Promise<FollowIdsResponse> {
    const rows = await this.prisma.sellerFollow.findMany({
      where: { userId },
      select: { sellerId: true },
      orderBy: { createdAt: 'desc' },
    })

    return { sellerIds: rows.map((row) => row.sellerId) }
  }

  async follows(userId: string, params: FollowListQueryParams): Promise<FollowListResponse> {
    const limit = params.limit ?? FOLLOW_LIST_DEFAULT_LIMIT
    const rows = await this.prisma.$queryRaw<FollowRow[]>`
      SELECT s."id"::text      AS "sellerId",
             s."brandName"     AS "brandName",
             s."slug"          AS "slug",
             s."logoUrl"       AS "logoUrl",
             s."followerCount" AS "followerCount",
             f."createdAt"     AS "followedAt"
        FROM "SellerFollow" f
        JOIN "Seller" s ON s."id" = f."sellerId"
       WHERE f."userId" = ${userId}::uuid
         AND (${params.cursor ?? null}::timestamp IS NULL
              OR f."createdAt" < ${params.cursor ?? null}::timestamp)
       ORDER BY f."createdAt" DESC
       LIMIT ${limit + 1}`
    const page = rows.slice(0, limit)

    return {
      sellers: page.map((row) => ({
        sellerId: row.sellerId,
        brandName: row.brandName,
        slug: row.slug,
        logoUrl: row.logoUrl,
        followerCount: row.followerCount,
        followedAt: row.followedAt.toISOString(),
      })),
      nextCursor: rows.length > limit ? (page.at(-1)?.followedAt.toISOString() ?? null) : null,
    }
  }

  /**
   * 최대 개수를 넘으면 오래된 것을 지운다 (F5).
   *
   * 한 문장인 이유는 「몇 개인지 세고 → 넘으면 지운다」가 두 문장이면 그 사이에 남이
   * 끼어들 수 있기 때문이다. 넘지 않으면 아무것도 지우지 않는다.
   */
  private async prune(userId: string): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM "RecentlyViewed"
       WHERE "userId" = ${userId}::uuid
         AND "productId" NOT IN (
           SELECT "productId" FROM "RecentlyViewed"
            WHERE "userId" = ${userId}::uuid
            ORDER BY "viewedAt" DESC
            LIMIT ${RECENTLY_VIEWED_MAX})`
  }
}

interface WishlistRow {
  readonly productId: string
  readonly productName: string
  readonly brandName: string
  readonly thumbnailUrl: string | null
  readonly price: number | null
  readonly addedPrice: number | null
  readonly notifyRestock: boolean
  readonly addedAt: Date
}

interface RecentRow {
  readonly productId: string
  readonly productName: string
  readonly brandName: string
  readonly thumbnailUrl: string | null
  readonly price: number | null
  readonly viewedAt: Date
}

interface FollowRow {
  readonly sellerId: string
  readonly brandName: string
  readonly slug: string
  readonly logoUrl: string | null
  readonly followerCount: number
  readonly followedAt: Date
}
