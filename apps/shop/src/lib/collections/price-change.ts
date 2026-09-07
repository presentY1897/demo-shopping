/**
 * 담을 때의 가격과 지금의 가격 (TASK-0086 F5).
 *
 * **두 값을 계약이 함께 보낸다** — `addedPrice` 는 담던 순간의 최저가이고 `price` 는
 * 지금의 최저가다(`wishlistItemSchema`). 위시리스트가 그 둘을 나란히 싣는 이유가
 * 여기 있다: 「담아 뒀는데 싸졌다」는 사람이 이 화면에 오는 이유의 절반이고, 그것을
 * 화면이 스스로 알아낼 방법은 없다. 지난 가격은 서버만 기억한다.
 *
 * ## 백분율을 만들지 않는다
 *
 * 「12% 내렸습니다」는 반올림을 한 번 해야 하고, 그 반올림은 어느 쪽으로 해도
 * 틀린다 — 올리면 실제보다 큰 인하를 주장하게 되고(상품 카드가 `Math.floor` 를 쓰는
 * 이유), 내리면 0.6% 인하가 「0% 내렸습니다」가 된다. 금액은 그런 자리가 없다:
 * 3,000원 내린 것은 3,000원 내린 것이다. 이 저장소가 금액을 정수로만 다루는 것과
 * 같은 결이다 (CLAUDE.md 6장).
 *
 * ## 다섯 갈래인 이유
 *
 * 「없어졌다」와 「모른다」와 「그대로」는 사람이 할 일이 다르다. 품절이면 재입고
 * 알림을 걸고, 담을 때도 품절이었으면 비교할 것이 애초에 없으며, 그대로면 아무 말도
 * 하지 않는 것이 맞다 — 「가격 변동 없음」을 모든 줄에 적으면 정말 변한 줄이 묻힌다.
 */

export type PriceChange =
  /** 지금 팔 수 있는 조합이 없다. 가격 자리에 그릴 숫자 자체가 없다 (`soldOut`) */
  | { readonly kind: 'gone' }
  /** 담을 때도 팔 수 있는 조합이 없었다. 비교할 지난 값이 없다 */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'same' }
  /** 담을 때보다 싸졌다. `amount` 는 내린 폭 */
  | { readonly kind: 'dropped'; readonly amount: number }
  /** 담을 때보다 비싸졌다. `amount` 는 오른 폭 */
  | { readonly kind: 'raised'; readonly amount: number }

export function priceChange(addedPrice: number | null, price: number | null): PriceChange {
  if (price === null) return { kind: 'gone' }
  if (addedPrice === null) return { kind: 'unknown' }
  if (price < addedPrice) return { kind: 'dropped', amount: addedPrice - price }
  if (price > addedPrice) return { kind: 'raised', amount: price - addedPrice }

  return { kind: 'same' }
}
