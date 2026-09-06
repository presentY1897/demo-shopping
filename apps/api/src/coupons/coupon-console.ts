import type { CouponLifecycle } from '@shopping/shared'

/**
 * 발행자 콘솔의 순수 판단 (TASK-0073 · TASK-0074, 6.2 Q5).
 *
 * 여기 있는 것은 하나다 — **쿠폰이 지금 어떤 상태인가.** 저장하지 않고 매번
 * 계산하는 이유는 그중 셋이 시간의 함수이기 때문이다: 기간이 지나면 아무도 아무것도
 * 하지 않아도 끝난 쿠폰이 되고, 그것을 칸에 적어 두면 그 칸을 옮기는 배치가 하나 더
 * 필요해지며, **그 배치가 멈춘 동안 화면은 거짓을 말한다.**
 *
 * 순서가 규칙이다. 위엣것이 아래를 가린다 — 끝난 쿠폰은 중단됐든 소진됐든 끝난
 * 것이고, 중단된 쿠폰에 「아직 시작 전」이라고 말하면 발행자는 기다리면 되는 줄 안다.
 */

/** 상태를 정하는 데 쓰이는 쿠폰의 칸들. */
export interface CouponLifecycleInput {
  readonly validFrom: Date
  readonly validUntil: Date
  readonly suspendedAt: Date | null
  readonly issueLimit: number | null
  readonly issuedCount: number
}

/**
 * 이 쿠폰이 지금 어떤 상태인가.
 *
 * `ENDED` 의 경계가 열린 구간인 것(`now >= validUntil`)은 발급 판정과 같은 순간을
 * 가리켜야 하기 때문이다 (`coupon-rules.ts` 의 `issuabilityFault`). 어긋나면 목록이
 * 「진행 중」이라고 적은 쿠폰을 발급 요청이 「기간이 지났다」로 거절한다.
 */
export function couponLifecycleOf(coupon: CouponLifecycleInput, now: Date): CouponLifecycle {
  if (now.getTime() >= coupon.validUntil.getTime()) return 'ENDED'
  if (coupon.suspendedAt !== null) return 'SUSPENDED'
  if (now.getTime() < coupon.validFrom.getTime()) return 'SCHEDULED'
  if (coupon.issueLimit !== null && coupon.issuedCount >= coupon.issueLimit) return 'EXHAUSTED'

  return 'ACTIVE'
}
