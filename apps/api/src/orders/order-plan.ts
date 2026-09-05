import type { OrderItemSnapshot } from '@shopping/shared'
import type { PricedOrder } from '@shopping/shared'

/**
 * 계산 결과를 저장할 행의 모양으로 옮긴다 (TASK-0049).
 *
 * 트랜잭션에서 떼어 놓은 이유는 6.2 의 「주문 생성 트랜잭션은 분기 커버리지 100%」
 * 때문이다. `await` 가 섞인 파일에서 100% 를 요구하면 닿을 수 없는 방어 분기가
 * 생기고, 그것은 게이트를 만족시키려고 코드를 나쁘게 만드는 일이다. 그래서
 * **판단만 여기 있고** 트랜잭션에는 쓰기만 남는다 (4.7).
 *
 * 여기서 하는 판단은 셋이다 — 어느 항목이 어느 계산 결과에 대응하는가, 판매자별로
 * 어떻게 묶이는가, 그리고 각 줄이 저장할 숫자가 무엇인가.
 *
 * **대응이 어긋나면 던진다.** 계산 엔진은 입력 항목마다 결과를 하나씩 내므로
 * 정상 경로에서는 일어나지 않지만, 「일어나지 않는다」는 것은 지금 참인 성질이지
 * 앞으로도 참인 성질이 아니다. 조용히 건너뛰면 **주문 금액이 항목 합보다 적어지고**
 * 그 차액은 아무 데도 기록되지 않는다.
 */

/** 주문될 한 줄. 장바구니에서 읽어 스냅샷까지 만들어 둔 상태다. */
export interface OrderLine {
  /** 계산 엔진이 이 줄을 부르는 이름. 장바구니 줄 id 를 그대로 쓴다. */
  readonly itemId: string
  readonly variantId: string
  readonly sellerId: string
  readonly brandName: string
  readonly unitPrice: number
  readonly quantity: number
  readonly snapshot: OrderItemSnapshot
}

/** 저장될 항목 한 줄. */
export interface PlannedItem {
  readonly line: OrderLine
  readonly productAmount: number
  readonly couponDiscountAmount: number
  readonly pointDiscountAmount: number
  readonly discountAmount: number
}

/** 저장될 판매자 몫 하나. */
export interface PlannedSellerOrder {
  readonly sellerId: string
  readonly brandName: string
  readonly items: readonly PlannedItem[]
  readonly productAmount: number
  readonly couponDiscountAmount: number
  readonly pointDiscountAmount: number
  readonly shippingPointAmount: number
  readonly shippingFee: number
  readonly paidAmount: number
}

/** 저장될 주문 하나. */
export interface OrderPlan {
  readonly sellerOrders: readonly PlannedSellerOrder[]
  readonly totalProductAmount: number
  readonly totalCouponDiscountAmount: number
  readonly totalPointDiscountAmount: number
  readonly totalShippingFee: number
  readonly paidAmount: number
}

/** 한 판매자의 줄들을 모으는 동안의 상태. */
interface Group {
  readonly brandName: string
  readonly items: PlannedItem[]
}

/**
 * 계산 결과와 줄을 맞춰 판매자별로 묶는다.
 *
 * 묶는 순서는 **줄이 처음 나타난 순서**다. 판매자 id 로 정렬하면 화면의 순서가
 * uuid 값에 따라 정해지고, 그것은 사람에게 아무 뜻이 없다 — 장바구니에서 보던
 * 순서가 주문서에서도 유지되는 편이 낫다.
 */
function groupsOf(lines: readonly OrderLine[], priced: PricedOrder): Map<string, Group> {
  const amounts = new Map(priced.items.map((item) => [item.itemId, item]))
  const groups = new Map<string, Group>()

  for (const line of lines) {
    const amount = amounts.get(line.itemId)

    if (amount === undefined) {
      throw new Error(`계산 결과에 없는 주문 줄입니다: ${line.itemId}`)
    }

    const item: PlannedItem = {
      line,
      productAmount: amount.productAmount,
      couponDiscountAmount: amount.couponDiscountAmount,
      pointDiscountAmount: amount.pointDiscountAmount,
      discountAmount: amount.discountAmount,
    }
    const held = groups.get(line.sellerId)

    if (held === undefined) {
      groups.set(line.sellerId, { brandName: line.brandName, items: [item] })
      continue
    }

    held.items.push(item)
  }

  return groups
}

/**
 * 저장할 것 전부.
 *
 * 판매자 몫은 **계산 결과의 순서**가 아니라 줄의 순서를 따른다. 계산 엔진은
 * 판매자별 합계를 자기 순서로 내는데, 그것은 화면이 알 바가 아니다.
 */
export function planOrder(lines: readonly OrderLine[], priced: PricedOrder): OrderPlan {
  const groups = groupsOf(lines, priced)
  const sellerOrders = [...groups].map(([sellerId, group]) => {
    const totals = priced.sellerOrders.find((entry) => entry.sellerId === sellerId)

    if (totals === undefined) {
      throw new Error(`계산 결과에 없는 판매자입니다: ${sellerId}`)
    }

    return {
      sellerId,
      brandName: group.brandName,
      items: group.items,
      productAmount: totals.productAmount,
      couponDiscountAmount: totals.couponDiscountAmount,
      pointDiscountAmount: totals.pointDiscountAmount,
      shippingPointAmount: totals.shippingPointAmount,
      shippingFee: totals.shippingFee,
      paidAmount: totals.paidAmount,
    }
  })

  return {
    sellerOrders,
    totalProductAmount: priced.totalProductAmount,
    totalCouponDiscountAmount: priced.totalCouponDiscountAmount,
    totalPointDiscountAmount: priced.totalPointDiscountAmount,
    totalShippingFee: priced.totalShippingFee,
    paidAmount: priced.paidAmount,
  }
}
