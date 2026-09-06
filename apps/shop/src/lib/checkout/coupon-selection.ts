import type { ApplicableCoupon } from '@shopping/shared'

/**
 * 중복 사용 규칙 (TASK-0075) — **플랫폼 한 장 + 판매자당 한 장**.
 *
 * **규칙이지 컴포넌트의 사정이 아니다.** 여기 있는 것은 「지금 이만큼 골라 둔
 * 사람이 저 장을 누르면 다음 선택은 무엇인가」 하나이고, 그 답은 화면이 어떻게
 * 생겼는지·요청이 언제 나가는지와 무관하다. 훅 안에 두면 규칙을 검사하려고
 * 렌더러와 목 서버를 세워야 하고, 그러면 「같은 판매자 쿠폰 두 장」 같은 조합을
 * 하나씩 확인하는 대신 대표적인 것 몇 개만 보게 된다.
 *
 * **막지 않고 밀어낸다.** 두 번째 플랫폼 쿠폰을 누른 사람에게 「이미 한 장
 * 고르셨어요」로 답하면, 그 사람은 무엇을 지워야 하는지 스스로 찾아 두 번 눌러야
 * 한다. 고른 것이 곧 바꾸고 싶다는 뜻이므로 첫 장이 조용히 빠진다 — 어느 장이
 * 빠졌는지는 목록의 체크가 그대로 보여 준다.
 *
 * 서버도 같은 규칙을 갖고 있고(`couponSelectionFaults` 의 `duplicate_platform` ·
 * `duplicate_seller`), 그것이 실제 규칙이다. 여기 있는 것은 **거절당할 요청을
 * 애초에 만들지 않기 위한 것**이지 검사 대신이 아니다.
 */

/**
 * 한 장이 차지하는 자리.
 *
 * 플랫폼 쿠폰은 전부 같은 자리를 두고 다투고, 판매자 쿠폰은 그 가게의 자리를 두고
 * 다툰다. 「누구와 부딪히는가」를 이 문자열 하나로 줄여 두면 중복 판정이 비교
 * 한 번이 되고, 규칙이 늘어날 때 바뀌는 곳도 이 함수 하나다.
 */
function slotOf(coupon: ApplicableCoupon): string {
  const { issuerType, sellerId } = coupon.userCoupon.coupon

  if (issuerType === 'PLATFORM') return 'platform'

  // 판매자 쿠폰인데 `sellerId` 가 없는 행은 DB 가 막는다 (`Coupon_issuer_check`).
  // 그래도 왔다면 **가장 좁게** 취급한다 — 자리를 장마다 다르게 주면 그런 행이
  // 여러 장 함께 골라지고, 그 조합은 서버가 거절한다.
  return `seller:${sellerId ?? ''}`
}

/**
 * 이 장을 누른 뒤의 선택.
 *
 * 이미 고른 장을 다시 누르면 빠지고, 아니면 **같은 자리를 쓰던 장을 밀어내고**
 * 들어간다. 순서는 그대로 두고 새 장을 뒤에 붙인다 — 고른 순서가 곧 쿼리스트링의
 * 순서이므로, 같은 선택이 매번 같은 문자열이 되어야 요청이 헛돌지 않는다.
 *
 * `catalogue` 에 없는 id 는 **건드리지 않는다.** 무엇과 부딪히는지 모르는 장을
 * 조용히 빼면 사람이 고른 적 없는 선택이 만들어지고, 그 선택으로 주문이 나간다.
 * 목록에 없는 장을 서버가 거절하는 것이 옳은 결말이다.
 */
export function toggledSelection(
  selection: readonly string[],
  userCouponId: string,
  catalogue: readonly ApplicableCoupon[],
): readonly string[] {
  if (selection.includes(userCouponId)) {
    return selection.filter((id) => id !== userCouponId)
  }

  const chosen = catalogue.find((entry) => entry.userCoupon.id === userCouponId)

  // 모르는 장은 고를 수 없다. 화면이 목록에 있는 것만 그리므로 여기 오지 않지만,
  // 오는 날 선택에 넣으면 그 다음 요청 전부가 400 이 된다.
  if (chosen === undefined) return selection

  const taken = slotOf(chosen)

  return [
    ...selection.filter((id) => {
      const held = catalogue.find((entry) => entry.userCoupon.id === id)

      return held === undefined || slotOf(held) !== taken
    }),
    userCouponId,
  ]
}

/**
 * 이 장을 지금 고를 수 있는가 — 즉 체크박스를 그릴 것인가.
 *
 * 못 쓰는 장도 목록에 남는다(F2). 고를 수 있는 것과 보여 줄 것이 다르다는 사실이
 * 이 함수 하나에 모여 있어, 화면이 `fault === null` 을 세 군데에서 따로 판단하는
 * 일이 생기지 않는다.
 */
export function isChoosable(coupon: ApplicableCoupon): boolean {
  return coupon.fault === null
}

/**
 * 이 선택이 부담 주체별로 몇 장인가 — 검사와 설명을 위한 값.
 *
 * 규칙이 지켜졌는지를 **선택 하나만 보고** 말할 수 있게 한다. `toggledSelection`
 * 이 옳은지는 「누른 뒤의 배열」로도 확인할 수 있지만, 그 확인은 마지막 한 번의
 * 조작만 본다 — 여러 번 누른 뒤에도 규칙이 서 있는지는 이쪽이 답한다.
 */
export function slotCounts(
  selection: readonly string[],
  catalogue: readonly ApplicableCoupon[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()

  for (const id of selection) {
    const entry = catalogue.find((coupon) => coupon.userCoupon.id === id)

    if (entry === undefined) continue

    const slot = slotOf(entry)

    counts.set(slot, (counts.get(slot) ?? 0) + 1)
  }

  return counts
}
