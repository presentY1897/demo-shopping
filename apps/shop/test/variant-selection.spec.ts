/**
 * 옵션 선택 로직 (TASK-0043 F1 · F2 · F3).
 *
 * Pure input to output, and tested that way. What is being pinned down is the
 * distinction the screen rests on: **품절과 없는 조합은 다르다.** One is a SKU
 * that exists and cannot be bought today; the other was never made. A module
 * that returned one boolean for both would let a screen say 「품절」 about a
 * combination the seller never offered.
 */

import { storefrontProductDetail, storefrontProductWithoutOptions } from '@shopping/api-mocks'
import { describe, expect, it } from 'vitest'

import {
  availability,
  choose,
  displayPrice,
  purchaseLimit,
  selectedVariant,
} from '@/lib/products/variant-selection'

const product = storefrontProductDetail.product
const [colour, size] = product.options

/** A value id by its label, so the tests read as a shopper would. */
function valueId(optionName: string, label: string): string {
  const option = product.options.find((entry) => entry.name === optionName)
  const value = option?.values.find((entry) => entry.value === label)

  if (value === undefined) throw new Error(`없는 선택지: ${optionName} ${label}`)

  return value.id
}

describe('선택지의 상태', () => {
  it('is available everywhere before anything is chosen, except what is nowhere orderable', () => {
    const states = availability(product, {})

    // 블랙 as a colour is fine — only 블랙·S is out of stock, and 블랙·M exists.
    expect(states[colour!.id]?.[valueId('색상', '블랙')]).toBe('available')
    expect(states[size!.id]?.[valueId('사이즈', 'S')]).toBe('available')
  })

  it('marks a combination that exists and is out of stock as 품절 (F2)', () => {
    const states = availability(product, { [colour!.id]: valueId('색상', '블랙') })

    expect(states[size!.id]?.[valueId('사이즈', 'S')]).toBe('sold_out')
    expect(states[size!.id]?.[valueId('사이즈', 'M')]).toBe('available')
  })

  it('calls a combination somebody else is checking out 품절 too (TASK-0048 F6)', () => {
    // 실물 재고는 그대로인데 남이 주문서에 들고 있다. 화면이 `stock` 을 읽으면
    // 「구매 가능」으로 보여 준 뒤 주문에서 거절하게 된다 — 가장 나쁜 순서다.
    const ivory = valueId('색상', '아이보리')
    const medium = valueId('사이즈', 'M')
    const reserved = {
      ...product,
      variants: product.variants.map((variant) =>
        variant.optionValueIds.includes(ivory) && variant.optionValueIds.includes(medium)
          ? { ...variant, availableStock: 0 }
          : variant,
      ),
    }

    // 대조: 같은 조합이 예약 전에는 살 수 있었다.
    expect(availability(product, { [colour!.id]: ivory })[size!.id]?.[medium]).toBe('available')
    expect(availability(reserved, { [colour!.id]: ivory })[size!.id]?.[medium]).toBe('sold_out')
    // 실물 재고는 줄지 않았다. 품절의 근거는 가용재고 쪽이다.
    expect(selectedVariant(reserved, { [colour!.id]: ivory, [size!.id]: medium })?.stock).toBe(8)
  })

  it('marks a combination nobody made as 없는 조합 (F3)', () => {
    const states = availability(product, { [colour!.id]: valueId('색상', '카멜') })

    // 카멜·L 과 카멜·XL 은 variant 자체가 없다. 품절과 같은 말이 아니다.
    expect(states[size!.id]?.[valueId('사이즈', 'L')]).toBe('missing')
    expect(states[size!.id]?.[valueId('사이즈', 'XL')]).toBe('missing')
    expect(states[size!.id]?.[valueId('사이즈', 'S')]).toBe('available')
  })

  it('reads one axis from the other axes only, so a choice does not eat itself', () => {
    const chosen = { [colour!.id]: valueId('색상', '블랙'), [size!.id]: valueId('사이즈', 'M') }
    const states = availability(product, chosen)

    // 아이보리 is still selectable even though 블랙 is chosen — otherwise the
    // colour axis would collapse to whatever was clicked last.
    expect(states[colour!.id]?.[valueId('색상', '아이보리')]).toBe('available')
  })
})

describe('확정된 variant', () => {
  it('is null until every axis is chosen', () => {
    expect(selectedVariant(product, {})).toBeNull()
    expect(selectedVariant(product, { [colour!.id]: valueId('색상', '블랙') })).toBeNull()
  })

  it('names the SKU, price and stock of the combination (F1)', () => {
    const variant = selectedVariant(product, {
      [colour!.id]: valueId('색상', '블랙'),
      [size!.id]: valueId('사이즈', 'S'),
    })

    expect(variant?.sku).toBe('LUMIKNIT-1')
    expect(variant?.stock).toBe(0)
  })

  it('is null for a combination that was never made', () => {
    expect(
      selectedVariant(product, {
        [colour!.id]: valueId('색상', '카멜'),
        [size!.id]: valueId('사이즈', 'XL'),
      }),
    ).toBeNull()
  })

  it('is the single variant of a product with no axes, immediately', () => {
    const { product: plain } = storefrontProductWithoutOptions

    // Otherwise a product with no options would never show a price: that one
    // variant is the thing carrying it (DECISIONS 3).
    expect(selectedVariant(plain, {})?.sku).toBe('LUMISCARF-9')
  })
})

describe('고르기와 되돌리기', () => {
  it('clears the value when it was already chosen', () => {
    const chosen = choose({}, colour!.id, valueId('색상', '카멜'))

    expect(chosen[colour!.id]).toBe(valueId('색상', '카멜'))
    expect(choose(chosen, colour!.id, valueId('색상', '카멜'))[colour!.id]).toBeUndefined()
  })

  it('leaves the other axes alone, because it never has to touch them', () => {
    // A value is only ever offered when a variant exists for it together with
    // what is already selected, so a choice the screen allows cannot invalidate
    // one already made.
    const withM = { [size!.id]: valueId('사이즈', 'M') }
    const next = choose(withM, colour!.id, valueId('색상', '카멜'))

    expect(next[size!.id]).toBe(valueId('사이즈', 'M'))
  })
})

describe('수량 상한과 가격', () => {
  it('caps at the smaller of the limit and the stock', () => {
    const variant = selectedVariant(product, {
      [colour!.id]: valueId('색상', '아이보리'),
      [size!.id]: valueId('사이즈', 'M'),
    })

    // effectiveMaxPurchaseQuantity 3, 재고 8 → 3.
    expect(purchaseLimit(product, variant)).toBe(3)
  })

  it('caps at the available stock, not the shelf (TASK-0048 F6)', () => {
    const variant = selectedVariant(product, {
      [colour!.id]: valueId('색상', '아이보리'),
      [size!.id]: valueId('사이즈', 'M'),
    })

    // 상한 3, 실물 8, 그중 2개만 남았다 → 2. `stock` 을 봤다면 3이 나온다.
    expect(purchaseLimit(product, { ...variant!, availableStock: 2 })).toBe(2)
  })

  it('shows the cheapest orderable price before anything is chosen', () => {
    const shown = displayPrice(product, null)

    expect(shown).toEqual({ price: 118_000, listPrice: 158_000 })
  })

  it('shows the chosen variant’s own price once there is one', () => {
    const variant = selectedVariant(product, {
      [colour!.id]: valueId('색상', '블랙'),
      [size!.id]: valueId('사이즈', 'M'),
    })

    expect(displayPrice(product, variant)).toEqual({ price: 118_000, listPrice: 158_000 })
  })
})
