import { allocate } from './allocate.js'
import type {
  PricedItem,
  PricedOrder,
  PricedSellerOrder,
  PricingDiscount,
  PricingInput,
  ShippingPolicy,
} from './types.js'

/**
 * 주문 금액 계산 (TASK-0047).
 *
 * `docs/design/pricing.md` 1장의 순서 그대로다:
 *
 * ```
 * ① 상품 금액   Σ (단가 × 수량)
 * ③ 쿠폰 할인   항목별 안분
 * ④ 배송비      판매자 단위, 조건부 무료
 * ⑤ 적립금 사용 ①−③+④ 범위 안에서, 항목별 안분
 * 실결제금액 = ① − ③ + ④ − ⑤
 * ```
 *
 * (②「상품 할인」은 정가↔판매가 차액이라 `unitPrice` 에 이미 반영돼 있다.)
 *
 * **순수 함수다.** 데이터베이스도 시계도 보지 않는다 — 같은 입력이면 언제나 같은
 * 답이고, 그래야 주문에 저장된 값을 나중에 다시 계산해 검증할 수 있다.
 *
 * **할인은 목록으로 받는다** (D-036). 지금은 대개 빈 배열이지만 M11 에서 쿠폰과
 * 적립금이 이 목록에 들어온다 — 계산기를 두 번 만들지 않기 위해서다.
 */

/** 이 계산에 실제로 적용되는 할인만. 가리키는 것이 없으면 조용히 빠진다. */
function applicable(
  discount: PricingDiscount,
  items: readonly { readonly itemId: string; readonly sellerId: string }[],
): readonly string[] {
  if (discount.scope === 'ORDER') return items.map((item) => item.itemId)

  if (discount.scope === 'SELLER') {
    return items.filter((item) => item.sellerId === discount.targetId).map((item) => item.itemId)
  }

  return items.filter((item) => item.itemId === discount.targetId).map((item) => item.itemId)
}

function policyFor(policies: readonly ShippingPolicy[], sellerId: string): ShippingPolicy | null {
  return policies.find((policy) => policy.sellerId === sellerId) ?? null
}

/**
 * 배송비 (④).
 *
 * 정책이 없으면 0원이다 — 「모르니까 일단 3,000원」은 아무도 동의한 적 없는 금액을
 * 청구하는 일이다.
 *
 * 무료 판정의 기준은 **쿠폰까지 반영한 상품금액**이다 (`pricing.md` 1장). 적립금은
 * 들어가지 않는다: 적립금을 썼다고 무료배송을 잃으면 자기 잔액을 쓴 것이 벌이 된다.
 */
function shippingFeeFor(policy: ShippingPolicy | null, basis: number): number {
  if (policy === null) return 0
  if (policy.freeThreshold !== null && basis >= policy.freeThreshold) return 0

  return policy.fee
}

/**
 * 계산이 진행되는 동안의 한 줄.
 *
 * Map 조회 대신 이 배열을 들고 다니는 이유는 `allocate` 와 같다 — `map.get(id) ?? 0`
 * 의 `?? 0` 은 결코 실행되지 않는 분기이고, 닿을 수 없는 방어는 커버리지에 영원한
 * 구멍으로 남는다.
 */
interface WorkingLine {
  readonly itemId: string
  readonly sellerId: string
  readonly productAmount: number
  coupon: number
  point: number
}

export function calculateOrder(input: PricingInput): PricedOrder {
  const lines: WorkingLine[] = input.items.map((item) => ({
    itemId: item.itemId,
    sellerId: item.sellerId,
    productAmount: item.unitPrice * item.quantity,
    coupon: 0,
    point: 0,
  }))

  /**
   * ③ 쿠폰 먼저. 적립금의 상한이 쿠폰을 뺀 뒤의 금액이므로 순서가 바뀔 수 없다.
   *
   * **깎을 수 있는 것보다 큰 쿠폰은 거기까지만 적용된다.** 10,000원짜리 주문에
   * 20,000원 쿠폰을 쓰면 10,000원이 깎이고 끝이다 — 나머지는 아무 데도 가지 않는다.
   * 그것을 안분해 버리면 항목의 할인이 상품금액을 넘고, 부분 취소에서 환불액이
   * 음수가 된다.
   *
   * 그래서 응답의 `totalCouponDiscountAmount` 는 **실제로 적용된 금액**이다.
   */
  for (const discount of input.discounts.filter((entry) => entry.type === 'COUPON')) {
    const targets = applicable(discount, lines)
    const reachable = lines.filter((line) => targets.includes(line.itemId))
    const room = reachable.reduce((sum, line) => sum + line.productAmount - line.coupon, 0)
    const allocated = allocate(
      Math.min(discount.amount, room),
      reachable.map((line) => ({
        item: line,
        weight: line.productAmount,
        cap: line.productAmount - line.coupon,
      })),
    )

    for (const entry of allocated) entry.item.coupon += entry.amount
  }

  const totalProductAmount = lines.reduce((sum, line) => sum + line.productAmount, 0)
  const totalCoupon = lines.reduce((sum, line) => sum + line.coupon, 0)

  // ④ 배송비. 판매자 단위이고, 판정 기준은 그 판매자의 상품금액 − 그 판매자에게
  // 안분된 쿠폰이다 (`pricing.md` 1장).
  const sellerIds = [...new Set(lines.map((line) => line.sellerId))]
  const stores = sellerIds.map((sellerId) => {
    const own = lines.filter((line) => line.sellerId === sellerId)
    const basis = own.reduce((sum, line) => sum + line.productAmount - line.coupon, 0)

    return {
      sellerId,
      shippingFee: shippingFeeFor(policyFor(input.shippingPolicies, sellerId), basis),
      shippingPoint: 0,
    }
  })
  const totalShippingFee = stores.reduce((sum, store) => sum + store.shippingFee, 0)

  /**
   * ⑤ 적립금. 「① − ③ + ④ 범위 내에서 차감」이 명세이므로 그 값이 상한이다.
   *
   * 넘게 요청되면 **깎아서 쓴다.** 던지지 않는 이유는 이것이 순수 계산기이기
   * 때문이다 — 「적립금을 그만큼 쓸 수 있는가」는 잔액을 아는 쪽이 물을 질문이고,
   * 여기서 할 수 있는 정직한 일은 낼 돈보다 많이 깎지 않는 것뿐이다.
   */
  const payableBeforePoints = totalProductAmount - totalCoupon + totalShippingFee
  const requestedPoints = input.discounts
    .filter((entry) => entry.type === 'POINT')
    .reduce((sum, entry) => sum + entry.amount, 0)
  const usablePoints = Math.max(0, Math.min(requestedPoints, payableBeforePoints))

  /**
   * 적립금은 **물건 값을 먼저 덮고, 남은 것이 배송비를 낸다.**
   *
   * 배송비를 낸 몫까지 항목에 붙이면 그 항목의 할인이 상품금액을 넘고, 부분
   * 취소에서 환불액이 음수가 된다. 무작위 검사(F8)가 그 상태를 실제로 잡아냈다.
   */
  const goodsTotal = lines.reduce((sum, line) => sum + line.productAmount - line.coupon, 0)
  const pointsOnGoods = Math.min(usablePoints, goodsTotal)
  const onGoods = allocate(
    pointsOnGoods,
    lines.map((line) => {
      const room = line.productAmount - line.coupon

      return { item: line, weight: room, cap: room }
    }),
  )

  for (const entry of onGoods) entry.item.point = entry.amount

  const onShipping = allocate(
    usablePoints - pointsOnGoods,
    stores.map((store) => ({ item: store, weight: store.shippingFee, cap: store.shippingFee })),
  )

  for (const entry of onShipping) entry.item.shippingPoint = entry.amount

  const items: PricedItem[] = lines.map((line) => ({
    itemId: line.itemId,
    sellerId: line.sellerId,
    productAmount: line.productAmount,
    couponDiscountAmount: line.coupon,
    pointDiscountAmount: line.point,
    discountAmount: line.coupon + line.point,
  }))

  const sellerOrders: PricedSellerOrder[] = stores.map((store) => {
    const own = lines.filter((line) => line.sellerId === store.sellerId)
    const productAmount = own.reduce((sum, line) => sum + line.productAmount, 0)
    const coupon = own.reduce((sum, line) => sum + line.coupon, 0)
    const point = own.reduce((sum, line) => sum + line.point, 0)

    return {
      sellerId: store.sellerId,
      productAmount,
      couponDiscountAmount: coupon,
      pointDiscountAmount: point,
      shippingPointAmount: store.shippingPoint,
      discountAmount: coupon + point + store.shippingPoint,
      shippingFee: store.shippingFee,
      paidAmount: productAmount - coupon - point + store.shippingFee - store.shippingPoint,
    }
  })

  const totalPoint =
    lines.reduce((sum, line) => sum + line.point, 0) +
    stores.reduce((sum, store) => sum + store.shippingPoint, 0)

  return {
    items,
    sellerOrders,
    totalProductAmount,
    totalCouponDiscountAmount: totalCoupon,
    totalPointDiscountAmount: totalPoint,
    totalDiscountAmount: totalCoupon + totalPoint,
    totalShippingFee,
    paidAmount: totalProductAmount - totalCoupon - totalPoint + totalShippingFee,
  }
}
