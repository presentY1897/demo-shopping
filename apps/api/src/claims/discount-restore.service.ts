import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'

import { PointsService } from '../points/points.service.js'
import type { RefundLedgerItem } from './refund-plan.js'
import { clawbackAmount, couponRestoreDecision, pointRestoreTotal } from './discount-restore.js'

type Tx = Prisma.TransactionClient

/** 이번 환불이 실제로 되돌린 것. 스펙과 로그가 읽는 값이다. */
export interface RestoreOutcome {
  readonly points: number
  readonly coupons: readonly string[]
  readonly clawedBack: number
  readonly clawbackShortfall: number
}

/**
 * 환불이 할인을 되돌린다 (TASK-0078).
 *
 * **환불 트랜잭션 안에서 돈다** (R1). 현금·쿠폰·적립금은 한 사건이고, 그중 하나만
 * 따로 커밋되면 되돌릴 수 없는 어긋남이 남는다 — 적립금은 돌아왔는데 현금은 안
 * 나갔거나, 쿠폰만 되살아난 주문이 그것이다.
 *
 * 순서는 `pricing.md` 4장의 **적용의 역순**이다: ① 적립금 → ② 쿠폰 → ③ 현금(저쪽).
 * 순서가 뜻을 갖는 자리는 하나뿐이지만 — 회수는 복구 뒤라야 그 사이에 늘어난 잔액을
 * 볼 수 있다 — 나머지도 문서와 같은 차례로 둔다. 읽는 사람이 두 곳을 견주게 된다.
 */
@Injectable()
export class DiscountRestoreService {
  constructor(private readonly points: PointsService) {}

  async restoreWithin(
    tx: Tx,
    input: {
      readonly claimId: string
      readonly orderId: string
      readonly sellerOrderId: string
      readonly userId: string
      readonly items: readonly RefundLedgerItem[]
      /** 이번에 실제로 나가는 현금. 확정 후 반품의 회수 비율이 이것으로 정해진다. */
      readonly refundedNow: number
    },
  ): Promise<RestoreOutcome> {
    const points = pointRestoreTotal(input.items)

    await this.points.restoreWithin(tx, {
      userId: input.userId,
      amount: points,
      refId: input.claimId,
    })

    const coupons = await this.restoreCoupons(tx, input.orderId)
    const clawback = await this.clawback(tx, input)

    return {
      points,
      coupons,
      clawedBack: clawback.taken,
      clawbackShortfall: clawback.shortfall,
    }
  }

  /**
   * 이 주문에 쓰인 쿠폰 중 **되돌릴 수 있는 것**을 되돌린다 (F3 · F4).
   *
   * 「닿은 몫이 전부 환불됐는가」를 묻는 자리다. 판매자 쿠폰이면 그 가게의 몫 하나이고
   * 플랫폼 쿠폰이면 이 주문의 몫 전부다 — 문서는 「`SellerOrder` 의 모든 항목이
   * 취소되면」이라고만 적고 있었고, 그대로 읽으면 두 가게에 걸친 플랫폼 쿠폰이 한쪽만
   * 취소돼도 돌아온다 (D-225).
   *
   * **넷을 함께 비운다.** 상태·시각·주문·금액은 「썼다」를 이루는 한 사실이고
   * (`UserCoupon_used_check`), 금액만 남기면 되돌아온 쿠폰이 여전히 정산에서
   * 차감된다.
   *
   * 조건부 갱신인 것은 발급과 같은 이유다 — `WHERE "status" = 'USED'` 가 두 번째
   * 시도를 0행으로 만든다 (F8).
   */
  private async restoreCoupons(tx: Tx, orderId: string): Promise<readonly string[]> {
    const used = await tx.userCoupon.findMany({
      where: { orderId, status: 'USED' },
      select: { id: true, coupon: { select: { sellerId: true } } },
    })

    if (used.length === 0) return []

    const sellerOrders = await tx.sellerOrder.findMany({
      where: { orderId },
      select: { id: true, sellerId: true, items: { select: { id: true, quantity: true } } },
    })
    const refunded = await this.refundedUnitsOf(tx, orderId)
    const restored: string[] = []

    for (const entry of used) {
      // 판매자 쿠폰은 그 가게의 몫만, 플랫폼 쿠폰은 이 주문의 몫 전부를 본다.
      const reach = sellerOrders
        .filter(
          (share) => entry.coupon.sellerId === null || share.sellerId === entry.coupon.sellerId,
        )
        .map((share) => ({
          fullyRefunded: share.items.every((item) => (refunded.get(item.id) ?? 0) >= item.quantity),
        }))

      if (couponRestoreDecision({ used: true, reach }) !== null) continue

      const taken = await tx.$executeRaw`
        UPDATE "UserCoupon"
           SET "status" = 'ISSUED', "usedAt" = NULL, "orderId" = NULL,
               "discountAmount" = NULL, "updatedAt" = now()
         WHERE "id" = ${entry.id}::uuid AND "status" = 'USED'
      `

      if (taken > 0) restored.push(entry.id)
    }

    return restored
  }

  /**
   * 이 주문의 항목마다 **환불이 끝난** 수량.
   *
   * `REFUNDED` 클레임만 센다 — 승인만 된 것은 아직 돈이 나가지 않았고, 쿠폰을
   * 되돌릴지는 「돌려줬나」에 달렸다. 이번 클레임은 부르는 쪽이 이미 그 상태로
   * 옮긴 뒤라 여기 포함된다.
   */
  private async refundedUnitsOf(tx: Tx, orderId: string): Promise<ReadonlyMap<string, number>> {
    const rows = await tx.claimItem.groupBy({
      by: ['orderItemId'],
      where: { claim: { status: 'REFUNDED', sellerOrder: { orderId } } },
      _sum: { quantity: true },
    })

    return new Map(rows.map((row) => [row.orderItemId, row._sum.quantity ?? 0]))
  }

  /**
   * 구매확정 후 반품이면 지급된 적립금을 되가져온다 (F5 · F6).
   *
   * 지급이 있었는지는 **원장이 답한다** — 확정이 적립을 남겼다면 그 몫을 가리키는
   * `EARN` 행이 있다. 상태로 묻지 않는 이유는 상태가 이미 `RETURNED` 로 옮겨진 뒤일
   * 수 있어서이고, 원장은 지나간 일을 잊지 않는다.
   */
  private async clawback(
    tx: Tx,
    input: {
      readonly claimId: string
      readonly sellerOrderId: string
      readonly userId: string
      readonly refundedNow: number
    },
  ): Promise<{ taken: number; shortfall: number }> {
    const earned = await tx.pointTransaction.findFirst({
      where: { type: 'EARN', refType: 'SELLER_ORDER', refId: input.sellerOrderId },
      select: { earnRateBp: true },
    })

    // 적립이 없었으면 되가져올 것도 없다 — 확정을 지나지 않은 몫이다.
    const earnRateBp = earned?.earnRateBp ?? null

    if (earnRateBp === null) return { taken: 0, shortfall: 0 }

    const sellerOrder = await tx.sellerOrder.findUniqueOrThrow({
      where: { id: input.sellerOrderId },
      select: { paidAmount: true },
    })
    // **이번 것을 빼고** 센다. 이 클레임의 환불 행은 방금 쓰였고, 회수는 「이번
    // 환불이 더 가져가는 몫」이라 앞의 것들만 누계에 들어간다.
    const before = await tx.claimRefund.aggregate({
      where: { claim: { sellerOrderId: input.sellerOrderId, id: { not: input.claimId } } },
      _sum: { amount: true },
    })
    const amount = clawbackAmount({
      paidAmount: sellerOrder.paidAmount,
      refundedBefore: before._sum.amount ?? 0,
      refundedNow: input.refundedNow,
      earnRateBp,
    })

    return this.points.clawbackWithin(tx, {
      userId: input.userId,
      amount,
      refId: input.claimId,
      reason: '구매확정 후 반품으로 지급된 적립금을 회수',
    })
  }
}
