import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import type {
  AppliedCoupon,
  ApplicableCoupon,
  CheckoutCouponsResponse,
  CouponApplicabilityFault,
  CouponSelectionFault,
} from '@shopping/shared'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { domainFailure } from '../common/domain-failure.js'
import type { OrderSource } from '../orders/order-source.js'
import { couponLinesOf } from '../orders/order-source.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { toCoupon } from './coupon.service.js'
import type { CouponApplication, CouponCandidate } from './coupon-apply.js'
import { applyCoupons, evaluateCoupon, recommendCoupons, selectionFault } from './coupon-apply.js'

type Tx = Prisma.TransactionClient

/**
 * 쿠폰을 주문서에 얹는 일 (TASK-0075).
 *
 * 판단은 전부 `coupon-apply.ts` 에 있다. 여기 남는 것은 **데이터베이스와 닿는
 * 세 가지**뿐이다 — 이 사람의 쿠폰을 읽고, 고른 것을 확인하고, 주문이 저장될 때
 * 소진한다.
 *
 * ## 소진의 동시성 — 조건부 갱신
 *
 * 한 장을 두 주문서에서 동시에 「주문하기」 하면 「읽고 · 판단하고 · 쓰는」 구현은
 * 둘 다 `ISSUED` 를 읽고 둘 다 통과한다. 그래서 판단과 갱신이 **한 문장**이다.
 *
 * ```sql
 * UPDATE "UserCoupon" SET "status" = 'USED', … WHERE "id" = $1 AND "status" = 'ISSUED'
 * ```
 *
 * 행 잠금이 아니라 조건부 갱신인 것은 TASK-0065 4.1 의 기준 그대로다 — **판단이 그
 * 행 안에서 끝나는가.** 여기서 판단에 필요한 값은 `status` 하나이고 그것은 이 행에
 * 있다. 「이 쿠폰이 이 주문에 얼마를 깎는가」는 다른 표를 봐야 알지만 그 판단은
 * 이미 끝났고(`resolve`), 이 문장이 답하는 것은 「아직 안 썼는가」뿐이다.
 *
 * 진 쪽은 0행을 고치고 **주문 트랜잭션 전체가 롤백된다**. 그것이 옳은 이유는 진
 * 쪽의 주문서가 쿠폰이 적용된 금액을 보여 준 채였기 때문이다 — 쿠폰 없이 주문을
 * 만들어 주면 사는 사람이 동의한 적 없는 금액이 결제된다.
 */
@Injectable()
export class CouponApplyService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * 이 주문서에 대고 본 내 쿠폰들과 추천 조합 (F2 · F7).
   *
   * **쓸 수 없는 것도 사유와 함께 싣는다.** 목록에서 빼면 「분명히 쿠폰이 있었는데
   * 없어졌다」가 되고, 그 사람이 다음에 할 일을 화면이 말해 줄 수 없다.
   *
   * `ISSUED` 만 읽는 이유는 이 목록이 「지금 이 주문에 가져올 수 있는 것」이기
   * 때문이다. 이미 쓴 장과 만료된 장은 쿠폰함(TASK-0077)의 일이고, 여기 섞이면
   * 목록의 대부분이 회색이 된다. 그래도 `already_used` · `expired` 가 사유 목록에
   * 있는 것은 **골라서 보낸 것을 확인할 때** 나오기 때문이다 — 다른 탭에서 방금 쓴
   * 장이 그 답을 받는다.
   */
  async list(userId: string, source: OrderSource): Promise<CheckoutCouponsResponse> {
    const now = this.clock.now()
    const lines = couponLinesOf(source)
    const rows = await this.prisma.userCoupon.findMany({
      where: { userId, status: 'ISSUED' },
      // 곧 만료되는 것이 위다. 상한에 걸려 잘리는 것이 **가장 늦게 사라질 장**이라야
      // 잘림이 사람에게 손해가 되지 않는다.
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: CHECKOUT_COUPON_LIST_LIMIT,
      select: USER_COUPON_WITH_POLICY_SELECT,
    })
    const coupons: ApplicableCoupon[] = rows.map((row) => {
      const verdict = evaluateCoupon(toCandidate(row), lines, now)

      return {
        userCoupon: {
          id: row.id,
          couponId: row.couponId,
          userId: row.userId,
          status: row.status,
          expiresAt: row.expiresAt.toISOString(),
          issuedAt: row.issuedAt.toISOString(),
          usedAt: row.usedAt?.toISOString() ?? null,
          orderId: row.orderId,
          coupon: toCoupon(row.coupon),
        },
        discountAmount: verdict.discountAmount,
        fault: verdict.fault,
      }
    })
    const usable = rows
      .map((row) => toCandidate(row))
      .filter((candidate) => evaluateCoupon(candidate, lines, now).fault === null)

    return {
      coupons,
      recommendation: recommendCoupons(usable, lines, source.policies, now),
    }
  }

  /**
   * 고른 것을 확인하고 계산기에 넘길 목록으로 편다 (F3 · F4).
   *
   * **거절은 예외다.** 조용히 빼고 계산하는 길도 있지만, 그러면 화면이 「5,000원
   * 할인」을 보여 준 채로 그만큼 비싼 주문이 만들어진다. 못 쓰는 쿠폰을 골랐다는
   * 사실은 사는 사람이 알아야 하고, 알고 나서 뺄지 말지를 정한다.
   *
   * 아무것도 고르지 않았으면 **질의를 하나도 하지 않는다.** 쿠폰을 안 쓰는 주문이
   * 대부분이고, 그 길에 조회를 하나 얹으면 모든 주문서 읽기가 그 값을 낸다.
   */
  async resolve(
    userId: string,
    source: OrderSource,
    userCouponIds: readonly string[],
  ): Promise<CouponApplication> {
    // 같은 id 를 두 번 보낸 것은 한 번 보낸 것과 같은 뜻이다. 여기서 접지 않으면
    // 아래 개수 비교가 「없는 쿠폰」이라고 답하고, 그 문장은 참이 아니다.
    const ids = [...new Set(userCouponIds)]

    if (ids.length === 0) return { discounts: [], applied: [] }

    const now = this.clock.now()
    const lines = couponLinesOf(source)
    const rows = await this.prisma.userCoupon.findMany({
      where: { id: { in: ids }, userId },
      select: USER_COUPON_WITH_POLICY_SELECT,
    })

    // 남의 쿠폰과 없는 쿠폰이 **같은 답**을 받는다. 갈라 답하면 남의 쿠폰 id 를
    // 넣어 보는 것만으로 그 장의 존재를 알 수 있게 된다.
    if (rows.length !== ids.length) {
      throw new BadRequestException(
        domainFailure('COUPON_NOT_APPLICABLE', '쿠폰을 찾을 수 없어요.', {
          field: 'userCouponIds',
          params: { reason: 'unknown' },
        }),
      )
    }

    const candidates = rows.map((row) => toCandidate(row))
    const duplicate = selectionFault(candidates)

    if (duplicate !== null) throw refuseSelection(duplicate)

    for (const candidate of candidates) {
      const { fault } = evaluateCoupon(candidate, lines, now)

      if (fault !== null) throw refuseApplicability(fault)
    }

    return applyCoupons(candidates, lines, source.policies, now)
  }

  /**
   * 주문이 저장되는 트랜잭션 안에서 소진한다 (F5 · F6).
   *
   * **한 문장씩이고, 하나라도 지면 전부 없던 일이 된다.** Postgres 는 트랜잭션 안의
   * 한 문장이 실패하면 전체를 중단시키므로 되돌리는 코드를 따로 쓸 필요가 없고,
   * 여기서 던지는 것은 그 성질에 기댄다.
   *
   * 금액을 함께 쓰는 것이 F6 이다. 정산(M12)이 판매자 부담 쿠폰만 차감하려면 장별
   * 금액이 있어야 하고, 그 값은 **지금 말고는 알 수 없다** — 정률이면 그때의
   * 상품금액이 필요하고 겹쳐 덮인 장은 남은 만큼만 깎였다.
   */
  async consume(
    tx: Tx,
    userId: string,
    orderId: string,
    applied: readonly AppliedCoupon[],
    now: Date,
  ): Promise<void> {
    for (const entry of applied) {
      const taken = await tx.$executeRaw`
        UPDATE "UserCoupon"
           SET "status" = 'USED',
               "usedAt" = ${now},
               "orderId" = ${orderId}::uuid,
               "discountAmount" = ${entry.discountAmount},
               "updatedAt" = ${now}
         WHERE "id" = ${entry.userCouponId}::uuid
           AND "userId" = ${userId}::uuid
           AND "status" = 'ISSUED'
      `

      if (taken === 0) {
        throw new ConflictException(
          domainFailure('COUPON_ALREADY_USED', '방금 다른 주문에 사용된 쿠폰이에요.', {
            field: 'userCouponIds',
            params: { reason: 'already_used' },
          }),
        )
      }
    }
  }
}

/**
 * 주문서 화면이 한 번에 받아 보는 쿠폰의 수.
 *
 * 상한이 없으면 **한 사람의 쿠폰함이 응답의 크기와 추천의 비용을 정한다.** 곧
 * 만료되는 것부터 읽으므로 잘리는 것은 가장 늦게 사라질 장이고, 그 장은 다음
 * 주문에도 있다.
 */
export const CHECKOUT_COUPON_LIST_LIMIT = 100

/** 정책까지 함께 읽는다 — 판정에 할인율·범위·기간이 전부 필요하다. */
const USER_COUPON_WITH_POLICY_SELECT = {
  id: true,
  couponId: true,
  userId: true,
  status: true,
  expiresAt: true,
  issuedAt: true,
  usedAt: true,
  orderId: true,
  coupon: {
    select: {
      id: true,
      issuerType: true,
      sellerId: true,
      name: true,
      code: true,
      discountType: true,
      discountValue: true,
      maxDiscountAmount: true,
      minOrderAmount: true,
      scopeType: true,
      scopeIds: true,
      validFrom: true,
      validUntil: true,
      issueLimit: true,
      issuedCount: true,
    },
  },
} as const

type UserCouponWithPolicy = Prisma.UserCouponGetPayload<{
  select: typeof USER_COUPON_WITH_POLICY_SELECT
}>

/**
 * 두 행을 판정이 보는 한 값으로.
 *
 * `expiresAt` 은 **발급된 장의 것**이고 `validFrom` 은 정책의 것이다. 만료가
 * 스냅샷인 이유는 발행자가 나중에 기간을 줄여도 이미 받은 사람의 쿠폰이 소급해서
 * 짧아지면 안 되기 때문이고(`schema.prisma`), 시작은 스냅샷이 아니라 정책의
 * 사실이다 — 아직 시작하지 않은 쿠폰을 미리 지급하는 것이 정상 흐름이다.
 */
function toCandidate(row: UserCouponWithPolicy): CouponCandidate {
  return {
    userCouponId: row.id,
    couponId: row.couponId,
    name: row.coupon.name,
    issuerType: row.coupon.issuerType,
    sellerId: row.coupon.sellerId,
    status: row.status,
    expiresAt: row.expiresAt,
    validFrom: row.coupon.validFrom,
    discountType: row.coupon.discountType,
    discountValue: row.coupon.discountValue,
    maxDiscountAmount: row.coupon.maxDiscountAmount,
    minOrderAmount: row.coupon.minOrderAmount,
    scopeType: row.coupon.scopeType,
    scopeIds: row.coupon.scopeIds,
  }
}

/**
 * 사유마다 다른 문장을 준다.
 *
 * 하나로 묶지 않는 이유는 **사람이 할 일이 다르기** 때문이다. 금액이 모자란 사람은
 * 더 담으면 되고 만료된 쿠폰을 든 사람은 무엇을 해도 안 된다 — 「사용할 수 없는
 * 쿠폰입니다」는 그 둘 모두에게 틀린 말이다.
 */
const APPLICABILITY_MESSAGES: Readonly<Record<CouponApplicabilityFault, string>> = {
  already_used: '이미 사용한 쿠폰이에요.',
  expired: '사용 기간이 지난 쿠폰이에요.',
  not_started: '아직 사용할 수 있는 기간이 아니에요.',
  out_of_scope: '이 주문의 상품에는 쓸 수 없는 쿠폰이에요.',
  below_minimum: '최소 주문금액에 미치지 못해요.',
  no_discount: '이 주문에서는 할인되는 금액이 없어요.',
}

const SELECTION_MESSAGES: Readonly<Record<CouponSelectionFault, string>> = {
  duplicate_platform: '플랫폼 쿠폰은 주문당 한 장만 쓸 수 있어요.',
  duplicate_seller: '판매자 쿠폰은 판매자당 한 장만 쓸 수 있어요.',
}

function refuseApplicability(fault: CouponApplicabilityFault): Error {
  return new BadRequestException(
    domainFailure('COUPON_NOT_APPLICABLE', APPLICABILITY_MESSAGES[fault], {
      field: 'userCouponIds',
      // 화면이 사유별로 그리려면 문장이 아니라 이름이 필요하다. 문장을 보고
      // 분기하는 화면은 문장을 다듬는 순간 조용히 망가진다.
      params: { reason: fault },
    }),
  )
}

function refuseSelection(fault: CouponSelectionFault): Error {
  return new BadRequestException(
    domainFailure('COUPON_NOT_APPLICABLE', SELECTION_MESSAGES[fault], {
      field: 'userCouponIds',
      params: { reason: fault },
    }),
  )
}
