import type { Checkout } from '@shopping/shared'

/**
 * 결제창에 뜨는 주문 이름 (TASK-0055).
 *
 * **이 값은 우리 도메인에 없다.** 토스가 결제창과 영수증에 한 줄을 적어야 해서
 * 요구하는 것이고, 우리 주문서에는 판매자별로 나뉜 여러 줄이 있을 뿐이다. 그래서
 * 여기서 만든다 — 만드는 규칙이 컴포넌트 안에 있으면 「두 상품일 때 뭐라고 적히나」를
 * 물어볼 자리가 없다.
 *
 * **문장은 인자로 받는다.** 하드코딩 금지(CLAUDE.md 6장)이고, 그 덕에 이 함수는
 * 한국어를 모르는 순수 함수가 된다.
 */

/**
 * 토스가 받는 주문 이름의 길이 상한.
 *
 * 넘으면 저쪽이 요청을 거절하고, 그 거절은 사용자에게 「결제창이 안 뜬다」로만
 * 보인다 — 상품명이 긴 옷 한 벌이면 충분히 닿는 길이라 자르는 쪽을 고른다.
 */
export const TOSS_ORDER_NAME_MAX = 100

export interface OrderNameLabels {
  /** 한 건일 때. `{name}` */
  readonly single: string
  /** 여러 건일 때. `{name}` · `{count}` — 「티셔츠 외 2건」 */
  readonly more: string
}

/**
 * 「첫 상품 외 N건」. 상품이 하나면 그 이름뿐이다.
 *
 * 세는 것은 **줄 수**이지 수량이 아니다. 같은 옷 세 벌을 산 사람에게 「외 2건」은
 * 다른 물건 둘이 더 있다는 뜻으로 읽히고, 그것은 사실이 아니다.
 */
export function checkoutOrderName(checkout: Checkout, labels: OrderNameLabels): string {
  const items = checkout.sellerOrders.flatMap((group) => group.items)
  const first = items[0]

  if (first === undefined) return ''

  const name = first.snapshot.productName
  const sentence =
    items.length === 1
      ? labels.single.replace('{name}', name)
      : labels.more.replace('{name}', name).replace('{count}', String(items.length - 1))

  return sentence.slice(0, TOSS_ORDER_NAME_MAX)
}
