/**
 * 안분 — 하나의 금액을 여러 항목에 비례 배분한다 (TASK-0047 F2 · F3).
 *
 * `docs/design/pricing.md` 2장이 규칙이다:
 *
 * ```
 * 항목 안분액 = floor(전체 할인액 × 항목 상품금액 / 전체 상품금액)
 * 잔여(= 전체 할인액 − Σ 안분액)는 상품금액이 가장 큰 항목에 더한다
 * ```
 *
 * **잔여를 버리지 않는 것이 이 함수의 전부다.** 10,000원을 세 항목에 나누면
 * `floor` 셋의 합이 9,999원이고, 남은 1원은 어딘가로 가야 한다 — 버리면 「할인
 * 10,000원」이라고 적힌 화면과 실제로 빠진 9,999원이 어긋난다. 그 1원은 실제 돈이고
 * 정산까지 따라간다.
 *
 * **가장 큰 항목이 여럿이면 먼저 나온 것**이다. 순서를 정해 두지 않으면 같은 입력이
 * 실행마다 다른 답을 내고, 주문에 저장된 값을 나중에 재계산해 검증할 수 없다.
 */

export interface AllocationShare<T> {
  /**
   * 몫을 받을 것 자체.
   *
   * 이름표(키)를 받아 돌려주고 부르는 쪽이 다시 찾게 하지 않는다. 그러면 부르는
   * 쪽에 `map.get(key) ?? 0` 이 생기고, 그 `?? 0` 은 **결코 실행되지 않는 분기**가
   * 된다 — 키는 그쪽이 준 것이다. 닿을 수 없는 방어는 커버리지에 영원한 구멍으로
   * 남고, 그것을 면제하기 시작하면 100%가 의미를 잃는다.
   */
  readonly item: T
  /** 비례의 기준이 되는 금액. */
  readonly weight: number
  /**
   * 이 몫이 받을 수 있는 최대. 없으면 무제한.
   *
   * **잔여를 몰아주다 한도를 넘을 수 있기 때문에 있다.** 무게 `[2,2,2]` 에 5원을
   * 나누면 `floor` 셋이 1원씩이고 잔여가 2원인데, 그것을 가장 큰 항목에 다 주면
   * 그 항목은 3원을 받는다 — 자기 무게보다 많다. 적립금이 그 상태가 되면 항목의
   * 할인이 상품금액을 넘고, 부분 취소에서 환불액이 음수가 된다.
   */
  readonly cap?: number
}

/** 한 몫의 결과. **입력 순서 그대로** 돌아온다. */
export interface Allocated<T> {
  readonly item: T
  readonly amount: number
}

/** 한도. 없으면 무제한이다. */
function capOf<T>(share: AllocationShare<T>): number {
  return share.cap ?? Number.POSITIVE_INFINITY
}

/**
 * `total` 을 `shares` 의 무게에 비례해 나눈다. 합은 언제나 `total` 이다.
 *
 * 무게의 합이 0이면 (전부 0원짜리이거나 항목이 없으면) 나눌 비율이 없다. 그때는
 * **아무에게도 주지 않는다** — 균등 분배는 그럴듯해 보이지만 「0원짜리 항목에 할인
 * 3,333원이 붙어 있다」를 만들고, 부분 취소에서 그 금액이 환불액에서 빠진다.
 */
export function allocate<T>(
  total: number,
  shares: readonly AllocationShare<T>[],
): readonly Allocated<T>[] {
  const entries = shares.map((share) => ({ share, amount: 0 }))
  const weightTotal = shares.reduce((sum, share) => sum + share.weight, 0)

  if (total <= 0 || weightTotal <= 0) {
    return entries.map((entry) => ({ item: entry.share.item, amount: entry.amount }))
  }

  let assigned = 0

  for (const entry of entries) {
    const amount = Math.min(
      Math.floor((total * entry.share.weight) / weightTotal),
      capOf(entry.share),
    )

    entry.amount = amount
    assigned += amount
  }

  let remainder = total - assigned

  /**
   * 잔여는 **무게가 큰 것부터, 한도 안에서** 1원씩 준다.
   *
   * 명세는 「상품금액이 가장 큰 항목에 더한다」이고 한도가 없으면 그것과 같다 —
   * 잔여는 항목 수보다 작으므로 첫 항목이 전부 받는다. 한도에 걸릴 때만 다음
   * 항목으로 넘어가고, 그 경우는 명세가 말하지 않은 경우다.
   *
   * 동점이면 먼저 나온 것 — `sort` 가 안정 정렬이라 입력 순서가 유지된다.
   */
  for (const entry of [...entries].sort((left, right) => right.share.weight - left.share.weight)) {
    if (remainder <= 0) break

    const room = capOf(entry.share) - entry.amount

    if (room <= 0) continue

    const given = Math.min(remainder, room)

    entry.amount += given
    remainder -= given
  }

  return entries.map((entry) => ({ item: entry.share.item, amount: entry.amount }))
}
