import { Injectable } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service.js'

/**
 * 팔로워 수가 실제 팔로우 수와 맞는가 (TASK-0097 4장).
 *
 * `Seller.followerCount` 는 조건부 삽입·삭제의 결과로만 움직인다 (TASK-0089 4.1).
 * 그 규칙이 지켜지는 한 어긋날 수 없지만, **어긋나면 아무도 모른다** — 브랜드관의
 * 팔로워 수는 아무도 검산하지 않는 숫자이고, 틀려도 그럴듯해 보인다.
 *
 * `Seller_followerCount_check` 가 음수만 막는다. 「37이어야 하는데 42」는 제약이
 * 잡을 수 없는 어긋남이고, 그것이 이 대사가 있는 이유다.
 */

export interface FollowerDiscrepancy {
  readonly sellerId: string
  readonly followerCount: number
  readonly actualCount: number
}

@Injectable()
export class FollowConsistencyService {
  constructor(private readonly prisma: PrismaService) {}

  async followers(): Promise<readonly FollowerDiscrepancy[]> {
    return this.prisma.$queryRaw<FollowerDiscrepancy[]>`
      SELECT s."id"::text              AS "sellerId",
             s."followerCount"         AS "followerCount",
             COALESCE(f."count", 0)::int AS "actualCount"
        FROM "Seller" s
        LEFT JOIN (
          SELECT "sellerId", COUNT(*)::int AS "count" FROM "SellerFollow" GROUP BY 1
        ) f ON f."sellerId" = s."id"
       WHERE s."followerCount" <> COALESCE(f."count", 0)
       ORDER BY s."id"`
  }
}
