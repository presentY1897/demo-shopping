import type { CartItemNotice } from '@shopping/shared'

/**
 * 담은 뒤에 달라진 것을 가려낸다 (TASK-0045 F4 · F5).
 *
 * 순수 함수다 — 「무엇이 달라졌나」는 두 값의 비교이고, 그 판단이 서비스 안에
 * 흩어져 있으면 조회 경로마다 다르게 답한다.
 *
 * **하나의 불리언으로 뭉치지 않는다.** 사람이 할 일이 다르기 때문이다: 가격이
 * 올랐으면 살지 다시 정하는 것이고, 품절이면 빼는 것이고, 재고가 줄었으면 수량을
 * 낮추는 것이다. 「변동 있음」 하나로는 화면이 그 셋을 구별해 말할 수 없다.
 */

export interface CartLineState {
  readonly quantity: number
  readonly priceAtAdded: number
  readonly price: number
  readonly stock: number
  /** 판매 중인 조합인가 — 상품이 `ACTIVE` 이고 Variant 가 살아 있는가. */
  readonly sellable: boolean
}

export function noticesFor(line: CartLineState): readonly CartItemNotice[] {
  // 팔지 않는 것에 대해서는 가격도 재고도 말할 것이 없다. 「품절이고 가격이
  // 올랐습니다」는 살 수 없는 물건에 대한 두 줄이고, 사람이 할 일은 빼는 것 하나다.
  if (!line.sellable) return ['unavailable']

  const notices: CartItemNotice[] = []

  if (line.price > line.priceAtAdded) notices.push('price_increased')
  if (line.price < line.priceAtAdded) notices.push('price_decreased')

  if (line.stock === 0) notices.push('sold_out')
  else if (line.stock < line.quantity) notices.push('stock_reduced')

  return notices
}
