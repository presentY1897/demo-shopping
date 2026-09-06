/**
 * 쿠폰 때문에 거절당한 요청을 알아보는 자리 (TASK-0075).
 *
 * **두 거절이 같은 사실의 앞뒤다.** 고른 순간 주문서를 다시 읽다가 400 을 받는 것과,
 * 주문하는 순간 409 를 받는 것 — 사이에 다른 주문이 그 장을 태웠다는 하나의 사건이
 * 화면에 닿는 두 길이다. 그래서 알아보는 판단을 한곳에 둔다: 두 벌이면 한쪽의
 * 오타가 아무 데서도 드러나지 않고, 그 결과는 「주문하지 못했어요」라는 아무 도움도
 * 안 되는 문장이다 (`awaiting-result.ts` 가 결제에서 같은 것을 지킨다).
 *
 * ## 코드는 `DomainErrorCode` 로 적는다
 *
 * `Record<CouponRefusal, DomainErrorCode>` 라 **양쪽이 함께 잠긴다** — 거절이
 * 하나 늘면 짝지을 코드가 없다고 컴파일이 막고, 코드 이름을 오타내면 그 문자열이
 * `domainErrorCodes` 에 없다고 막는다. 그냥 `string` 으로 비교하면 오타가 조용히
 * 통과하고, 그 조용함의 결과가 하필 「주문하지 못했어요」다: 요청은 실패했고,
 * 화면은 무언가 보여 주고, 빨개지는 검사는 없다 (`claim-refusal.ts` 와 같은 장치).
 */

import type { ApiFailure, DomainErrorCode } from '@shopping/shared'
import { apiFailure } from '@shopping/shared'

/**
 * 쿠폰 때문에 거절당한 두 가지.
 *
 * 나눠 두는 이유는 **화면에서 나타나는 자리가 다르기** 때문이다. 앞의 것은 고르는
 * 중에 쿠폰 영역에서 일어나고, 뒤의 것은 주문 버튼을 누른 뒤 합계 옆에서 일어난다.
 * 하나로 뭉치면 어느 쪽 사람에게도 「지금 무엇을 보고 있는지」가 안 맞는 문장이 된다.
 */
export const couponRefusals = [
  /**
   * 고른 조합을 서버가 받아 주지 않았다 (400).
   *
   * 사람이 잘못 고른 것이 아니다 — 화면은 목록이 쓸 수 있다고 말한 장만 고르게
   * 한다. 그러니 이것은 **목록을 읽은 뒤에 세상이 바뀌었다**는 뜻이고, 다음에 할
   * 일은 다시 고르는 것이다.
   */
  'not_applicable',
  /** 그 사이에 다른 주문이 이 쿠폰을 썼다 (409). 주문 자체는 아직 만들어지지 않았다. */
  'already_used',
] as const

export type CouponRefusal = (typeof couponRefusals)[number]

/**
 * 거절마다 서버가 쓰는 코드.
 *
 * 거절 쪽을 키로 잡았다. 코드 쪽을 키로 잡으면 새 거절이 「아무 코드와도
 * 짝지어지지 않은 거절」로 조용히 태어나고, 그때 화면은 서버 문장을 그대로 흘린다.
 */
const CODE_OF: Readonly<Record<CouponRefusal, DomainErrorCode>> = {
  not_applicable: 'COUPON_NOT_APPLICABLE',
  already_used: 'COUPON_ALREADY_USED',
}

/** 실패 하나를 둘 중 하나로. 쿠폰과 무관한 실패면 `null` 이다. */
export function couponRefusalOf(failure: ApiFailure): CouponRefusal | null {
  if (failure.kind !== 'http') return null

  const entry = Object.entries(CODE_OF).find(([, code]) => code === failure.code)

  return entry === undefined ? null : (entry[0] as CouponRefusal)
}

/**
 * 던져진 것이 「고른 조합을 쓸 수 없다」인가.
 *
 * 주문서를 다시 읽는 훅을 위한 문이다 — 그쪽은 실패를 값으로 들고 있을 이유가
 * 없다. 화면이 하는 일은 선택을 되돌리는 것 하나뿐이고, 그 판단에 필요한 것은
 * 「그 코드였나」라는 참·거짓이다.
 *
 * **상태가 아니라 코드를 본다.** 주문서 조회의 400 은 쿠폰 말고도 여러 이유로
 * 나올 수 있고(쿼리가 계약을 벗어난 경우가 그렇다), 그 400 에 선택을 되돌리면
 * 사람은 자기 화면에서 쿠폰이 저절로 풀리는 것을 보게 된다.
 */
export function refusedForCoupons(error: unknown): boolean {
  return couponRefusalOf(apiFailure(error)) === 'not_applicable'
}

/**
 * 던져진 것이 「그 쿠폰은 이미 쓰였다」인가 (409).
 *
 * 위와 나란히 두는 이유는 **둘이 같은 사건의 앞뒤**이기 때문이다. 고르는 순간의
 * 400 과 주문하는 순간의 409 는 다른 화면·다른 훅이 받지만 원인이 하나이므로,
 * 그 하나를 알아보는 자리도 하나여야 한다 — 나뉘면 언젠가 한쪽만 코드를 고치고,
 * 그때 다른 쪽은 「주문하지 못했어요」로 되돌아간다.
 */
export function refusedAsUsedCoupon(error: unknown): boolean {
  return couponRefusalOf(apiFailure(error)) === 'already_used'
}
