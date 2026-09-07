import { Injectable } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service.js'

/**
 * 상품이 들고 있는 **파생값**이 원본과 맞는가 (TASK-0097 4장).
 *
 * ## 왜 대사가 필요한가
 *
 * `ratingAvg` 도 `minPrice` 도 원본이 따로 있고, 상품 행의 값은 그것을 **미리 세어
 * 둔 결과**다. 미리 세어 두는 이유는 목록 한 장이 상품마다 집계를 하면 N+1 이
 * 되기 때문이고(D-240), 그 대가가 「원본과 갈릴 수 있다」는 것이다.
 *
 * 갈리면 조용하다. 별점이 4.2 여야 하는데 3.8 로 남아 있어도 화면은 멀쩡히 그리고,
 * **어긋난 평점은 아무도 신고하지 않는다.**
 *
 * ## 고치지 않는다
 *
 * 검출하고 기록만 한다. 원인을 모르는 채 값을 고치면 **문제가 숨는다** — 다음 주에
 * 같은 자리가 또 어긋나도 배치가 조용히 덮어써 버리고, 그러면 원인을 찾을 기회가
 * 영영 사라진다.
 */

export interface RatingDiscrepancy {
  readonly productId: string
  readonly ratingAvg: number
  readonly ratingCount: number
  /** 리뷰를 지금 세면 나오는 값. */
  readonly actualAvg: number
  readonly actualCount: number
}

export interface MinPriceDiscrepancy {
  readonly productId: string
  readonly minPrice: number | null
  /** 팔 수 있는 조합의 최저가. 그런 조합이 없으면 `null`. */
  readonly actualMinPrice: number | null
}

@Injectable()
export class CatalogConsistencyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 평점 (`Product.ratingAvg` · `ratingCount`).
   *
   * **숨김·삭제된 리뷰는 세지 않는다** — 그것이 `refreshRating` 이 세는 규칙이므로
   * 대사도 같은 규칙으로 세야 한다. 다르게 세면 이 배치가 매번 「불일치」를 외치고,
   * 몇 번 반복되면 사람은 이 배치를 안 믿는다.
   */
  async ratings(): Promise<readonly RatingDiscrepancy[]> {
    return this.prisma.$queryRaw<RatingDiscrepancy[]>`
      SELECT p."id"::text                        AS "productId",
             p."ratingAvg"                       AS "ratingAvg",
             p."ratingCount"                     AS "ratingCount",
             COALESCE(r."avg", 0)::int           AS "actualAvg",
             COALESCE(r."count", 0)::int         AS "actualCount"
        FROM "Product" p
        LEFT JOIN (
          SELECT "productId",
                 -- 100배 정수. refreshRating 과 같은 반올림이어야 한다.
                 round(AVG("rating") * 100)::int AS "avg",
                 COUNT(*)::int                   AS "count"
            FROM "Review"
           WHERE "status" = 'PUBLISHED'
           GROUP BY 1
        ) r ON r."productId" = p."id"
       WHERE p."deletedAt" IS NULL
         AND (p."ratingAvg" <> COALESCE(r."avg", 0) OR p."ratingCount" <> COALESCE(r."count", 0))
       ORDER BY p."id"`
  }

  /**
   * 최저가 (`Product.minPrice`).
   *
   * 「팔 수 있는 조합」의 최저가다 — 내려둔 조합이나 지워진 조합은 값을 만들지
   * 않는다. `Product_active_price_check` 가 **판매 중인데 값이 없는** 상태를 막고
   * 있으므로, 여기서 잡는 것은 그 반대편이다: 값은 있는데 원본과 다른 경우.
   */
  async minPrices(): Promise<readonly MinPriceDiscrepancy[]> {
    return this.prisma.$queryRaw<MinPriceDiscrepancy[]>`
      SELECT p."id"::text AS "productId",
             p."minPrice" AS "minPrice",
             v."min"      AS "actualMinPrice"
        FROM "Product" p
        LEFT JOIN (
          SELECT "productId", MIN("price")::int AS "min"
            FROM "ProductVariant"
           WHERE "deletedAt" IS NULL AND "isActive" = true
           GROUP BY 1
        ) v ON v."productId" = p."id"
       WHERE p."deletedAt" IS NULL
         AND p."minPrice" IS DISTINCT FROM v."min"
       ORDER BY p."id"`
  }
}
