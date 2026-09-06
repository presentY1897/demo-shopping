import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PaymentService, REFUND_TX_OPTIONS } from '../payment/payment.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { DiscountRestoreService } from './discount-restore.service.js'
import type { CancelApproved, CancelRefundEvents } from './cancel-events.js'
import type { ClaimStatus, ClaimType } from './claim-rules.js'
import type { ClaimFault } from '@shopping/shared'
import { claimRuleFor, claimTransitionDecision } from './claim-rules.js'
import type { RefundBreakdown } from './refund-calc.js'
import type { RefundLedgerItem, ShippingPair } from './refund-plan.js'
import { cancelShipping, claimRefundBreakdown, returnShipping } from './refund-plan.js'
import type { RefundOutcome } from './refund-retry.js'
import { CANCEL_REFUND_REASON, RETURN_REFUND_REASON } from './refund-retry.js'
import type { ReturnCompleted, ReturnRefundEvents } from './return-events.js'

type Tx = Prisma.TransactionClient

/** 잠근 클레임에서 읽는 것. 판단에 필요한 것뿐이다. */
interface LockedClaim {
  readonly id: string
  readonly status: ClaimStatus
  readonly type: ClaimType
  /** 누구 탓인가. 반품에서 배송비를 가르는 축이다 (`pricing.md` 4장). */
  readonly fault: ClaimFault
  readonly sellerOrderId: string
}

/** `lastError` 에 남기는 최대 길이. 스택이 통째로 들어가면 목록이 읽히지 않는다. */
const ERROR_MAX_LENGTH = 500

/**
 * 클레임 하나의 환불을 **실제로 실행한다** (TASK-0068 · `docs/design/pricing.md` 4장).
 *
 * 계산은 `refund-calc.ts` 가, 그 입력을 저장된 사실에서 만드는 일은 `refund-plan.ts`
 * 가 한다. 여기 있는 것은 **순서와 잠금**뿐이다.
 *
 * ## 한 트랜잭션이다
 *
 * 항목별 환불액을 적고 · 결제사에 말하고 · `Refund` 를 남기고 · 누계를 갱신하고 ·
 * 클레임을 `REFUNDED` 로 옮기는 일이 **전부 한 트랜잭션 안**이다. 갈라 두면 그 틈에서
 * 죽은 프로세스가 「돈은 나갔는데 클레임은 승인된 채」를 남기고, 다음 주기의 재시도가
 * 그것을 **한 번 더 환불한다.** 이 TASK 가 막아야 하는 사고가 정확히 그것이다.
 *
 * 프로바이더 호출이 그 안에 있는 것은 `PaymentService.refundWithin` 의 결정이고, 그
 * 이유와 대가는 저쪽에 적혀 있다.
 *
 * ## 멱등의 열쇠는 클레임의 id 다
 *
 * 세 겹이 같은 것을 말한다.
 *
 * | 겹 | 무엇이 막나 |
 * | --- | --- |
 * | `ClaimRequest.status` 를 **잠그고** 본다 | 같은 클레임에 두 번 불린 호출. `REFUNDED` 는 종착이라 되돌아오는 화살표가 없다 |
 * | `ClaimRefund` 의 기본키가 `claimId` | 두 번째 환불 **기록**을 애초에 만들 수 없다 |
 * | 위의 한 트랜잭션 | 「돈은 나갔는데 안 적혔다」가 없으므로 위 둘이 거짓말을 하지 않는다 |
 *
 * 시각이나 난수를 섞지 않는 이유는 `cancel-events.ts` 가 적어 두었다 — 재발행이 다른
 * 열쇠를 갖게 되는데, 열쇠가 막아야 하는 것이 정확히 그 경우다.
 *
 * ## 잠그는 순서가 규칙이다
 *
 * **클레임 → 판매자 몫 → 결제.** 가운데를 빠뜨릴 수 없는 이유가 이 TASK 의 판단
 * 하나다 — 「이미 몇 개를 환불했나」를 **매번 원장에서 세기** 때문에, 세는 동안 같은
 * 주문 항목에 다른 환불이 끼어들면 두 환불이 각자 「지금까지 0개」를 읽는다. 그때
 * 합계는 항목의 순액과 1원 어긋나고(`floor` 이 두 번 따로 돌아서다), 그 1원은 아무
 * 검사도 잡지 못한다. 같은 주문 항목을 건드릴 수 있는 클레임은 **반드시 같은
 * `SellerOrder` 의 것**이므로 그 행 하나를 잠그면 줄이 선다 —
 * `ClaimService.settleCancel` 이 「전체인가」를 세기 전에 같은 행을 잠그는 것과 같은
 * 장치다.
 *
 * ## 던지지 않는다
 *
 * {@link settle} 은 무슨 일이 있어도 값으로 답한다. 환불에 실패한 것이 승인이나
 * 검수를 되돌릴 이유는 아니고(`cancel-events.ts` · `return-events.ts`), 되돌리려 해도
 * 전이표에 그 화살표가 없다. 실패는 `ClaimRefund` 행에 남아 재시도 배치와 운영자가
 * 읽는다 (`refund-retry.ts` · R3).
 */
@Injectable()
export class ClaimRefundService {
  private readonly log = new Logger(ClaimRefundService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly payments: PaymentService,
    // 할인의 복구 (TASK-0078). 현금과 **같은 트랜잭션**이어야 하므로 여기서
    // 부른다 — 환불 뒤에 따로 도는 배치로 두면 그 사이에 죽은 프로세스가 적립금을
    // 돌려주지 않은 주문을 남긴다.
    private readonly restores: DiscountRestoreService,
  ) {}

  /**
   * 이 클레임의 환불을 한 번 시도한다. **던지지 않는다.**
   *
   * 두 번 불려도 안전하고(위 세 겹), 환불로 갈 수 없는 자리면 아무것도 하지 않는다.
   */
  async settle(claimId: string): Promise<RefundOutcome> {
    try {
      return await this.prisma.$transaction(
        (tx) => this.settleWithin(tx, claimId),
        REFUND_TX_OPTIONS,
      )
    } catch (error) {
      this.log.error(`클레임 ${claimId} 의 환불에 실패했습니다.`, error)
      await this.recordFailure(claimId, error)

      return 'failed'
    }
  }

  /**
   * **지금 이 클레임을 환불하면 얼마인가** — 승인 버튼을 누르기 전의 답 (TASK-0070).
   *
   * ## 미리보기 전용 계산이 없다
   *
   * 부르는 것이 {@link plan} 과 `claimRefundBreakdown` 이고, 그 둘은 {@link settle}
   * 이 실제로 쓰는 바로 그것이다. 「환불 예정액」을 따로 계산하면 배송비 재부과나
   * 누적 반올림 같은 규칙이 두 벌이 되고, 어긋난 날 증상은 **판매자가 1,000원이라고
   * 읽고 승인한 뒤 2,000원이 나가는 것**이다 — 아무것도 실패하지 않는다.
   *
   * ## 잠그지 않는다
   *
   * 읽기이고 아무것도 쓰지 않는다. 승인이 그 사이에 일어나면 값이 낡을 수 있지만,
   * 그것은 **잠금으로 고칠 수 있는 문제가 아니다** — 사람이 화면을 보고 있는 몇
   * 초 동안 행을 잡고 있을 수는 없다. 대신 승인이 지나는 문(`settle`)이 스스로
   * 잠그고 **그 순간의 원장에서 다시 센다.** 미리보기와 실제가 갈리는 유일한 창은
   * 「보는 동안 다른 환불이 끼어드는 경우」이고, 그때 실제가 옳다.
   *
   * 아직 아무 항목도 걸리지 않은 클레임은 없다(`createClaimRequestSchema.items` 가
   * `min(1)` 이다). 그래서 답은 언제나 줄을 갖는다.
   */
  async quote(claimId: string): Promise<RefundBreakdown> {
    const claim = await this.claimOf(claimId)
    const plan = await this.plan(this.prisma, claim)

    return claimRefundBreakdown(plan.items, plan.shipping)
  }

  /** 마지막으로 성공한 시각과 실패 사유. 운영자 화면과 스펙이 읽는다. */
  async recordOf(claimId: string): Promise<ClaimRefundRecord | null> {
    return this.prisma.claimRefund.findUnique({
      where: { claimId },
      select: {
        claimId: true,
        paymentId: true,
        itemsAmount: true,
        shippingAmount: true,
        amount: true,
        refundedAt: true,
        attempts: true,
        lastError: true,
      },
    })
  }

  // ---------------------------------------------------------------- internals

  private async settleWithin(tx: Tx, claimId: string): Promise<RefundOutcome> {
    const claim = await this.lock(tx, claimId)

    // 이미 끝났다. 두 번째 호출이 여기서 멈추는 것이 멱등의 첫 겹이다.
    if (claim.status === 'REFUNDED') return 'settled'
    // **목록을 손으로 적지 않는다.** 「이 자리에서 환불로 갈 수 있는가」는 전이표가
    // 이미 답하는 물음이고, 거절된 클레임이 여기 오는 것은 사고가 아니라 정상이다
    // (배치가 유예를 지나 집어 온 뒤 사람이 그 사이에 거절했을 수 있다).
    if (claimRuleFor(claim.status, 'REFUNDED') === null) return 'ignored'

    await this.lockSellerOrder(tx, claim.sellerOrderId)

    const context = await this.context(tx, claim)
    const breakdown = claimRefundBreakdown(context.items, context.shipping)

    await this.writeLines(tx, claimId, breakdown)

    // **적용의 역순으로 되돌린다** (`pricing.md` 4장 · TASK-0078). 적립금과 쿠폰이
    // 먼저이고 현금이 마지막이다. 같은 트랜잭션인 것이 R1 이 요구하는 것이고, 그중
    // 하나만 따로 커밋되면 되돌릴 수 없는 어긋남이 남는다 — 적립금은 돌아왔는데
    // 현금은 안 나갔거나, 쿠폰만 되살아난 주문이 그것이다.
    //
    // 쿠폰 복원이 이 클레임을 `REFUNDED` 로 옮기기 **전에** 도는데도 이번 몫을 세는
    // 이유는 `moveToRefunded` 가 아래에 있기 때문이 아니라, 복원 판단이 읽는 것이
    // 상태가 아니라 **환불이 끝난 수량**이기 때문이다 — 그 수량은 방금 쓴
    // `ClaimItem` 이 아니라 `REFUNDED` 클레임의 합이고, 그래서 순서를 바꿔야 한다.
    await this.moveToRefunded(tx, claim)

    const restored = await this.restores.restoreWithin(tx, {
      claimId,
      orderId: context.orderId,
      sellerOrderId: claim.sellerOrderId,
      userId: await this.buyerOf(tx, context.orderId),
      items: context.items,
      refundedNow: breakdown.total,
    })

    // **0원이면 결제사를 부르지 않는다.** 반품비가 항목 환불액보다 큰 경우
    // (아주 싼 물건의 변심 반품)이고, `refundBreakdown` 이 0에서 바닥을 친 결과다.
    // `refundDecision` 은 0원을 `invalid_amount` 로 거절하므로 그대로 넘기면 끝난
    // 클레임이 영원히 실패한다 — 돌려줄 것이 없는 것과 돌려줄 수 없는 것은 다르다.
    if (breakdown.total > 0) {
      await this.payments.refundWithin(
        tx,
        context.paymentId,
        breakdown.total,
        claim.type === 'CANCEL' ? CANCEL_REFUND_REASON : RETURN_REFUND_REASON,
      )
    }

    await this.writeRecord(tx, claimId, context.paymentId, breakdown)

    // 회수하지 못한 몫은 **아무 원장에도 남지 않는다** — 움직임이 없기 때문이다.
    // 그것을 볼 자리가 아직 없어 로그 한 줄로 남긴다 (HANDOFF 의 이월 항목).
    if (restored.clawbackShortfall > 0) {
      this.log.warn(
        `적립금 회수가 잔액에 막혔습니다 — 클레임 ${claimId}, 못 가져온 ${String(restored.clawbackShortfall)}원`,
      )
    }

    return 'refunded'
  }

  /**
   * 클레임 행의 잠금을 잡고 그 줄을 읽는다.
   *
   * **한 문장이다.** 읽는 것이 잠근 그 행의 컬럼뿐이라, 잠금을 기다린
   * `SELECT … FOR UPDATE` 는 앞사람이 커밋한 값을 다시 읽는다 —
   * `ClaimService.lock` · `PaymentService.lock` 이 같은 이유로 같은 모양이다.
   */
  /** 이 주문을 산 사람. 적립금이 돌아갈 계정이다. */
  private async buyerOf(tx: Tx, orderId: string): Promise<string> {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { userId: true },
    })

    return order.userId
  }

  private async lock(tx: Tx, claimId: string): Promise<LockedClaim> {
    const rows = await tx.$queryRaw<readonly LockedClaim[]>`
      SELECT "id", "status"::text AS "status", "type"::text AS "type",
             "fault"::text AS "fault", "sellerOrderId"
        FROM "ClaimRequest"
       WHERE "id" = ${claimId}::uuid
       FOR UPDATE
    `
    const [row] = rows

    if (row === undefined) throw new NotFoundException('클레임을 찾을 수 없어요.')

    return row
  }

  /**
   * 잠그지 않고 같은 줄을 읽는다. **미리보기의 것**이다.
   *
   * {@link lock} 과 열이 같은 것이 요점이다 — 두 경로가 같은 사실 위에서 계산해야
   * 「미리 본 금액 = 실제 금액」이 성립한다. `SELECT … FOR UPDATE` 만 빠진다.
   */
  private async claimOf(claimId: string): Promise<LockedClaim> {
    const rows = await this.prisma.$queryRaw<readonly LockedClaim[]>`
      SELECT "id", "status"::text AS "status", "type"::text AS "type",
             "fault"::text AS "fault", "sellerOrderId"
        FROM "ClaimRequest"
       WHERE "id" = ${claimId}::uuid
    `
    const [row] = rows

    if (row === undefined) throw new NotFoundException('클레임을 찾을 수 없어요.')

    return row
  }

  /**
   * 판매자 몫의 행을 잠근다. **읽는 것이 없다** — 필요한 것은 잠금 자체다.
   *
   * 이 잠금이 없으면 같은 주문 항목을 건드리는 두 환불이 각자 「지금까지 몇 개를
   * 환불했나」를 세고, 둘 다 상대의 몫을 못 본다. 클래스 주석의 표가 그 결과다.
   */
  private async lockSellerOrder(tx: Tx, sellerOrderId: string): Promise<void> {
    await tx.$executeRaw`SELECT 1 FROM "SellerOrder" WHERE "id" = ${sellerOrderId}::uuid FOR UPDATE`
  }

  /** 이 환불이 보는 세상 전부 — 항목 원장 · 배송비 · 어느 결제인가. */
  private async context(tx: Tx, claim: LockedClaim): Promise<RefundContext> {
    const plan = await this.plan(tx, claim)

    return { paymentId: await this.paymentOf(tx, plan.orderId), ...plan }
  }

  /**
   * 계산에 들어가는 **입력을 저장된 사실에서 조립한다.**
   *
   * {@link settle} 과 {@link quote} 가 **이 한 함수를 나눠 쓴다.** 미리보기가 자기
   * 조립을 갖게 두면 「승인 전에 보여 준 금액」과 「실제 나간 금액」이 서로 다른
   * 사실에서 나오게 되고, 그 차이는 빨간 테스트가 아니라 **사람의 장부**에 남는다
   * (TASK-0070 R2 가 「두 벌로 만들지 않는다」고 적은 자리가 여기다).
   *
   * `paymentId` 만 저쪽에 남는다. 미리보기는 돈을 옮기지 않으므로 결제를 찾을
   * 필요가 없고, 오히려 찾으면 안 된다 — {@link paymentOf} 는 살아 있는 결제가
   * 없을 때 409 를 던지는데, 그것은 **환불의 사고**이지 미리보기의 답이 아니다.
   */
  private async plan(db: Tx, claim: LockedClaim): Promise<RefundPlan> {
    const sellerOrder = await db.sellerOrder.findUniqueOrThrow({
      where: { id: claim.sellerOrderId },
      select: {
        orderId: true,
        shippingFee: true,
        seller: { select: { shippingFee: true, freeShippingThreshold: true } },
      },
    })
    const items = await this.ledger(db, claim)

    return {
      orderId: sellerOrder.orderId,
      items,
      shipping:
        claim.type === 'CANCEL'
          ? cancelShipping(items, {
              // **둘을 나눠 넣는 것이 재부과 계산의 핵심이다.** 무료배송으로 0원을
              // 낸 사람과 3,000원을 낸 사람은 부분 취소 뒤에 서로 다른 답을 받는다.
              chargedShippingFee: sellerOrder.shippingFee,
              standardShippingFee: sellerOrder.seller.shippingFee,
              freeShippingThreshold: sellerOrder.seller.freeShippingThreshold,
            })
          : returnShipping(await this.returnFacts(db, claim)),
    }
  }

  /**
   * 이 판매자 몫의 **모든** 주문 항목과, 각각에 대한 두 수량.
   *
   * ## 「이미 몇 개를 환불했나」를 매번 센다
   *
   * `OrderItem.claimedQuantity` 처럼 캐시를 두지 않는다. 그 캐시가 있는 이유는
   * **초과 신청을 한 문장으로 막기 위해서**인데(`UPDATE … WHERE quantity -
   * claimedQuantity >= $q`), 환불에서 그 자리를 지키는 것은 이 수가 아니라
   * `Payment.canceledAmount` 와 `Payment_canceledAmount_check` 이고 그 판단과 쓰기는
   * 이미 결제 행 잠금 아래 한 곳에 있다. 즉 이 수는 **입장 심사가 아니라 회계
   * 입력**이라 경합을 막을 의무가 없다.
   *
   * 대신 **틀렸을 때 조용한 쪽이 캐시다.** 이 수가 1 어긋나면 환불액이 1원 어긋나고
   * (TASK-0068 R2), 그 1원은 어느 검사도 잡지 못한 채 사람의 장부에 남는다. 원장을
   * 세면 「어긋난다」는 상태 자체가 없다 — `REFUNDED` 클레임의 수량 합이 곧 정의다.
   *
   * 세는 값이 낡지 않는 것은 위의 판매자 몫 잠금이 지키고, 비용은 이미 있는
   * `ClaimItem_orderItemId_idx` 가 없앤다 — 한 주문 항목에 걸리는 클레임은 손에
   * 꼽는다.
   *
   * ## `type` 으로 거르지 않는다
   *
   * `settledLines` 는 취소만 세지만(「이 주문이 취소로 닫히는가」를 묻는다) 여기서
   * 묻는 것은 **「이 항목에서 돈이 얼마나 나갔나」**다. 환불된 반품도 그 돈을
   * 가져갔으므로 함께 센다 — 빼면 같은 수량을 두 번 환불한다.
   *
   * ## 두 수가 주문 수량을 넘지 못한다
   *
   * `refundedUnits + units` 는 **살아 있는 클레임이 잡고 있는 수량 이하**다.
   * `REFUNDED` 는 잡은 수량을 돌려주지 않고(`RELEASES_QUANTITY`), 신청은 조건부
   * `UPDATE` 한 문장으로만 그 수량을 잡으며, `OrderItem_claimedQuantity_check` 이
   * 마지막 줄로 남는다. 그래서 `refundBreakdown` 이 수량을 자르는 갈래는 이 경로에서
   * 닿지 않는다 — 여기서 한 번 더 막지 않는 이유이고, 막으면 영원히 채워지지 않는
   * 방어 분기가 하나 생긴다.
   *
   * 같은 이유로 `quantity` 가 0인 항목도 없다 (`OrderItem_quantity_check`). 그것이
   * 계산에서 0으로 나누는 유일한 길이다.
   */
  private ledger(tx: Tx, claim: LockedClaim): Promise<readonly RefundLedgerItem[]> {
    return tx.$queryRaw<readonly RefundLedgerItem[]>`
      SELECT oi."id" AS "orderItemId",
             oi."quantity",
             oi."productAmount",
             oi."couponDiscountAmount",
             oi."pointDiscountAmount",
             COALESCE(sum(ci."quantity") FILTER (
               WHERE c."status"::text = 'REFUNDED'
             ), 0)::int AS "refundedUnits",
             COALESCE(sum(ci."quantity") FILTER (
               WHERE ci."claimId" = ${claim.id}::uuid
             ), 0)::int AS "units"
        FROM "OrderItem" oi
        LEFT JOIN "ClaimItem" ci ON ci."orderItemId" = oi."id"
        LEFT JOIN "ClaimRequest" c ON c."id" = ci."claimId"
       WHERE oi."sellerOrderId" = ${claim.sellerOrderId}::uuid
       GROUP BY oi."id", oi."quantity", oi."productAmount",
                oi."couponDiscountAmount", oi."pointDiscountAmount"
       ORDER BY oi."id"
    `
  }

  /**
   * 반품이 신청 시점에 굳혀 둔 배송비 두 줄.
   *
   * **여기서 `returnCostShare` 를 다시 부르지 않는다.** 그 함수가 정한 답이 이미 이
   * 두 열이고(`ClaimService.create` 가 신청과 한 트랜잭션에 적는다), 그 뒤에 판매자가
   * 배송비 정책을 바꿔도 움직이지 않아야 한다 — `return-events.ts` 가 그 성질을
   * 명시했고 `ReturnDetail_bearer_amount_check` 가 두 열이 어긋난 행을 막는다. 다시
   * 계산하면 그 스냅샷이 무의미해진다.
   */
  private async returnFacts(tx: Tx, claim: LockedClaim) {
    const detail = await tx.returnDetail.findUnique({
      where: { claimId: claim.id },
      select: { originalShippingRefund: true, returnShippingDeduction: true },
    })

    // 부속 없는 반품은 신청이 만들지 않는다(한 트랜잭션이다). 그래도 갈래를 두는
    // 것은 타입이 `null` 을 허용하기 때문이고, 값을 지어내면 배송비가 조용히 0이 된다.
    if (detail === null) throw new ConflictException('반품 정보를 찾을 수 없어요.')

    return { ...detail, sellerAtFault: claim.fault === 'SELLER' }
  }

  /**
   * 이 주문의 **살아 있는** 결제.
   *
   * `Order.payments` 는 1:N 이다 — 실패하면 다시 결제하므로. 그중 환불을 받을 수 있는
   * 것은 매입이 끝났고 아직 다 돌려주지 않은 하나뿐이고, 그것이 없다는 것은 「돈을
   * 받은 적이 없는 주문의 클레임」이라 계산이 아니라 **사고**다. 조용히 0원으로
   * 넘어가면 그 주문은 영원히 환불되지 않으면서 아무것도 실패하지 않는다.
   */
  private async paymentOf(tx: Tx, orderId: string): Promise<string> {
    const payment = await tx.payment.findFirst({
      where: { orderId, status: { in: ['PAID', 'PARTIAL_CANCELED'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })

    if (payment === null) throw new ConflictException('환불할 결제를 찾을 수 없어요.')

    return payment.id
  }

  /**
   * 이번 몫을 신청의 줄에 적는다.
   *
   * `ClaimItem.refundAmount` 가 그 자리다 — 스키마가 그 열을 미리 만들어 두고 「값이
   * `0` 인 것은 0원이 아니라 **아직 계산하지 않았다**」라고 적어 둔 바로 그 열이다.
   */
  private async writeLines(tx: Tx, claimId: string, breakdown: RefundBreakdown): Promise<void> {
    const now = this.clock.now()

    for (const line of breakdown.lines) {
      await tx.claimItem.update({
        where: { claimId_orderItemId: { claimId, orderItemId: line.orderItemId } },
        data: { refundAmount: line.amount, updatedAt: now },
      })
    }
  }

  /** 환불 기록 한 줄. 열쇠가 클레임 id 라 두 번째 행이 있을 수 없다. */
  private async writeRecord(
    tx: Tx,
    claimId: string,
    paymentId: string,
    breakdown: RefundBreakdown,
  ): Promise<void> {
    const now = this.clock.now()
    const amounts = {
      paymentId,
      itemsAmount: breakdown.itemsAmount,
      shippingAmount: breakdown.shippingAmount,
      amount: breakdown.total,
      refundedAt: now,
      lastAttemptAt: now,
      updatedAt: now,
    }

    await tx.claimRefund.upsert({
      where: { claimId },
      create: { claimId, ...amounts, attempts: 1, createdAt: now },
      // **사유를 지운다.** 앞선 시도가 남긴 문장을 그대로 두면 「성공했는데 오류가
      // 적힌 행」이 되고, 그것을 읽는 사람은 무엇을 믿어야 할지 모른다.
      update: { ...amounts, attempts: { increment: 1 }, lastError: null },
    })
  }

  /**
   * 클레임을 `REFUNDED` 로 옮긴다. **주체는 `SYSTEM` 뿐이다.**
   *
   * `ClaimService.applyWithin` 을 부르지 않는 이유는 **주입의 방향** 때문이다 —
   * 환불 포트는 `ClaimService` 가 주입받는 것이라(`CANCEL_REFUND_EVENTS`), 이쪽이
   * 저쪽을 다시 주입받으면 `forwardRef` 없이 돌지 않는 고리가 생긴다. 대신 판단은
   * **같은 순수 함수**가 내린다(`claimTransitionDecision`): 이 자리에서 사람이
   * 「환불됨」을 누를 수 없다는 사실은 전이표 한 곳에만 적혀 있다.
   *
   * 이 자리에서만 쓸 수 있는 지름길도 쓰지 않는다. 상태를 곧바로 갱신하는 대신
   * 판정을 지나는 이유는, 잠근 뒤에 읽은 상태가 이미 종착이거나 남의 경로일 수 있고
   * 그때 조용히 덮어쓰면 이력이 거짓이 되기 때문이다.
   */
  private async moveToRefunded(tx: Tx, claim: LockedClaim): Promise<void> {
    const decision = claimTransitionDecision(claim.status, 'REFUNDED', 'SYSTEM')

    if (decision.outcome === 'refused') {
      throw new ConflictException('지금 상태에서는 환불할 수 없어요.')
    }

    const now = this.clock.now()

    await tx.claimRequest.update({
      where: { id: claim.id },
      data: { status: 'REFUNDED', updatedAt: now },
    })
    await tx.claimStatusHistory.create({
      data: {
        claimId: claim.id,
        fromStatus: claim.status,
        toStatus: 'REFUNDED',
        reason: null,
        actor: 'SYSTEM',
        // 사람이 없는 전이다. 여기 누군가를 적으면 이력에 「그 사람이 환불했다」는
        // 거짓이 남는다.
        actorId: null,
        createdAt: now,
      },
    })
  }

  /**
   * 실패를 남긴다. **롤백된 트랜잭션 밖이라 따로 연다.**
   *
   * 이것이 없으면 실패한 환불은 「승인됐는데 `REFUNDED` 로 안 간 클레임」으로만
   * 보이고, 그 상태에서 사람이 할 수 있는 일은 로그를 뒤지는 것뿐이다 (R3).
   *
   * **이 쓰기 자체도 던지지 않는다.** 실패를 적지 못한 것이 두 번째 예외가 되면
   * 배치의 한 건이 나머지 전부를 멈춘다.
   */
  private async recordFailure(claimId: string, error: unknown): Promise<void> {
    const now = this.clock.now()
    const lastError = messageOf(error)

    try {
      await this.prisma.claimRefund.upsert({
        where: { claimId },
        create: {
          claimId,
          attempts: 1,
          lastError,
          lastAttemptAt: now,
          createdAt: now,
          updatedAt: now,
        },
        update: { attempts: { increment: 1 }, lastError, lastAttemptAt: now, updatedAt: now },
      })
    } catch (nested) {
      this.log.error(`클레임 ${claimId} 의 환불 실패를 기록하지 못했습니다.`, nested)
    }
  }
}

/** 운영자와 스펙이 읽는 환불 기록 한 줄. */
export interface ClaimRefundRecord {
  readonly claimId: string
  readonly paymentId: string | null
  readonly itemsAmount: number
  readonly shippingAmount: number
  readonly amount: number
  readonly refundedAt: Date | null
  readonly attempts: number
  readonly lastError: string | null
}

/**
 * 계산이 보는 세상 — **환불과 미리보기가 나눠 쓴다.**
 *
 * `paymentId` 가 여기 없는 것이 그 나눔이다. 미리보기는 돈을 옮기지 않는다.
 */
interface RefundPlan {
  /** 결제를 찾을 때 쓴다. 환불만 필요하고 미리보기는 쓰지 않는다. */
  readonly orderId: string
  readonly items: readonly RefundLedgerItem[]
  readonly shipping: ShippingPair
}

/** 이 환불이 보는 세상 전부. */
interface RefundContext extends RefundPlan {
  readonly paymentId: string
}

/** 남길 만한 한 줄로. 스택이 통째로 들어가면 실패 목록이 읽히지 않는다. */
function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)

  return raw.slice(0, ERROR_MAX_LENGTH)
}

/**
 * 승인된 취소만큼 돈을 돌려주는 **실제 구현** (TASK-0068).
 *
 * `NoopCancelRefundEvents` 를 대신한다. 하나씩 차례로 부르는 이유는 한 건이 결제사와의
 * 왕복이기 때문이고, {@link ClaimRefundService.settle} 이 던지지 않으므로 한 건의
 * 실패가 나머지를 멈추지 않는다 — 그 성질을 여기서 다시 만들지 않는 것이 요점이다.
 */
@Injectable()
export class RefundingCancelEvents implements CancelRefundEvents {
  constructor(private readonly refunds: ClaimRefundService) {}

  async refund(events: readonly CancelApproved[]): Promise<void> {
    for (const event of events) await this.refunds.settle(event.idempotencyKey)
  }
}

/** 검수를 통과한 반품만큼 돈을 돌려주는 **실제 구현** (TASK-0068). */
@Injectable()
export class RefundingReturnEvents implements ReturnRefundEvents {
  constructor(private readonly refunds: ClaimRefundService) {}

  async refund(events: readonly ReturnCompleted[]): Promise<void> {
    for (const event of events) await this.refunds.settle(event.idempotencyKey)
  }
}
