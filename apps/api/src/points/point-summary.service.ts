import { Inject, Injectable } from '@nestjs/common'
import type { PointExpiringSoon, PointSummaryResponse } from '@shopping/shared'
import { POINT_EXPIRING_SOON_DAYS } from '@shopping/shared'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { earnedAmount } from './point-ledger.js'
import { PointsService } from './points.service.js'

/**
 * 적립금 화면이 묻는 것 (TASK-0077).
 *
 * 원장과 잔액은 `PointsService` 가 이미 답한다. 여기 있는 것은 **원장에 아직 행이
 * 없는 둘**이다 — 「곧 들어올 것」과 「곧 사라질 것」.
 *
 * 둘 다 화면을 위한 값이지 원장의 사실이 아니라는 점이 중요하다. 적립은 구매확정
 * 시점에 일어나고(`pricing.md` 5장) 만료는 배치가 옮기므로, 이 서비스가 답하는 수는
 * **아직 아무 데도 기록되지 않은 예상**이다. 그래서 원장을 쓰는 서비스와 나눠 두었다 —
 * 섞이면 「원장이 진실이다」가 흐려진다.
 */
@Injectable()
export class PointSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async summaryOf(userId: string): Promise<PointSummaryResponse> {
    const now = this.clock.now()
    const [account, pendingEarn, expiringSoon] = await Promise.all([
      this.points.balanceOf(userId),
      this.pendingEarnOf(userId),
      this.expiringSoonOf(userId, now),
    ])

    return { account, pendingEarn, expiringSoon }
  }

  /**
   * 구매확정을 기다리는 주문에서 **들어올** 적립금 (F6).
   *
   * **배송완료된 몫만 센다.** 준비중·배송중까지 세면 취소 한 번에 사라지는 수를
   * 「들어올 것」이라고 적게 되고, 그때 그 화면은 없어진 돈을 설명해야 한다. 배송이
   * 끝난 몫은 확정 아니면 반품인데, 반품은 사람이 신청해야 일어나는 일이라 기본
   * 경로가 아니다 — 아무도 아무것도 하지 않으면 D+7 에 자동 확정되고 이 수가 실제로
   * 들어온다 (`order-confirm.ts`).
   *
   * 몫마다 따로 반올림하는 것이 **정확한 계산이다.** 실제 적립도 몫마다 한 번씩
   * 일어나므로(`points-order-confirmed.ts`), 합계에 한 번 곱하면 확정 뒤의 잔액과
   * 어긋나는 수를 미리 보여 주게 된다.
   */
  private async pendingEarnOf(userId: string): Promise<number> {
    const policy = await this.points.policy()
    const rows = await this.prisma.sellerOrder.findMany({
      where: { status: 'DELIVERED', order: { userId } },
      select: { paidAmount: true },
    })

    return rows.reduce((sum, row) => sum + earnedAmount(row.paidAmount, policy.earnRateBp), 0)
  }

  /**
   * 곧 사라질 통들의 합과, 그중 **가장 이른** 시각.
   *
   * 합을 함께 내는 이유는 시각만으로는 사람이 할 일을 정할 수 없기 때문이다 —
   * 「9월 30일에 만료됩니다」는 100원이든 5만원이든 같은 문장이고, 둘에 대해 할 일이
   * 다르다.
   *
   * 잔액이 남은 통만 센다. 다 쓴 통에도 만료 시각은 남아 있지만 그것이 사라지는 것은
   * 아무에게도 아무 뜻이 없다.
   */
  private async expiringSoonOf(userId: string, now: Date): Promise<PointExpiringSoon | null> {
    const until = new Date(now.getTime() + POINT_EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1_000)
    const rows = await this.prisma.$queryRaw<
      readonly { readonly amount: number; readonly at: Date | null }[]
    >`
      SELECT COALESCE(sum(t."remainingAmount"), 0)::int AS "amount",
             min(t."expiresAt")                          AS "at"
        FROM "PointTransaction" t
        JOIN "PointAccount" a ON a."id" = t."accountId"
       WHERE a."userId" = ${userId}::uuid
         AND t."remainingAmount" > 0
         AND t."expiresAt" IS NOT NULL
         AND t."expiresAt" <= ${until}
    `
    const row = rows[0]

    // 합이 0이면 그 기간에 사라질 것이 없다는 뜻이고, 그때 `at` 도 `NULL` 이다.
    // 두 값을 따로 판단하지 않는 이유는 하나가 비면 다른 하나도 비기 때문이다.
    if (row === undefined || row.amount === 0 || row.at === null) return null

    return { amount: row.amount, at: row.at.toISOString() }
  }
}
