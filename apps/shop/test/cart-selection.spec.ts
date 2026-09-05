/**
 * 선택과 합계 (TASK-0046 F2 · F3 · F5 · F6). 입력 → 출력.
 *
 * 세 층이 서로를 어긋나게 하지 않는 것이 이 화면의 전부다 — 전체 · 그룹 · 개별.
 * 틀리면 사람은 자기가 무엇을 사는지 모르는 채로 결제 버튼을 누른다.
 */

import { emptyCart, shopperCart } from '@shopping/api-mocks'
import type { CartItem, CartResponse } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  allState,
  groupState,
  initialSelection,
  isSelectable,
  reconcile,
  selectableIds,
  toggleAll,
  toggleGroup,
  toggleItem,
} from '@/lib/cart/selection'
import { cartTotals } from '@/lib/cart/totals'

const cart: CartResponse = shopperCart
const [lumiere, nodestep] = cart.groups
const items = cart.groups.flatMap((group) => group.items)

function itemBy(predicate: (item: CartItem) => boolean): CartItem {
  const found = items.find(predicate)

  if (found === undefined) throw new Error('픽스처에서 찾지 못했습니다.')

  return found
}

const soldOut = itemBy((item) => item.notices.includes('sold_out'))
const coat = itemBy((item) => item.productName === '울 롱코트')
const knit = itemBy((item) => item.productName === '캐시미어 니트')

describe('고를 수 있는가', () => {
  it('refuses a sold-out line', () => {
    expect(isSelectable(soldOut)).toBe(false)
  })

  it('allows a line whose price merely changed', () => {
    // 가격이 오른 것은 **고를 수 없다는 뜻이 아니다.** 사람이 할 일이 다르다 —
    // 하나는 기다리는 것이고 하나는 다시 볼지 정하는 것이다.
    expect(isSelectable(itemBy((item) => item.notices.includes('price_increased')))).toBe(true)
  })

  it('starts with everything that can be bought', () => {
    // 아무것도 안 골라 둔 채로 열면 합계가 0원이고, 사람이 할 일이 「전부 다시
    // 고르기」가 된다.
    expect(initialSelection(cart)).toEqual(new Set(selectableIds(cart)))
    expect(initialSelection(cart).has(soldOut.id)).toBe(false)
  })
})

describe('세 층의 연동 (F3)', () => {
  it('turns the whole group off when it was fully on', () => {
    const next = toggleGroup(initialSelection(cart), lumiere!)

    expect(groupState(lumiere!, next)).toBe('unchecked')
    // 다른 그룹은 건드리지 않는다.
    expect(groupState(nodestep!, next)).toBe('checked')
    expect(allState(cart, next)).toBe('indeterminate')
  })

  it('turns a partly chosen group fully on', () => {
    const partial = new Set([coat.id])

    expect(groupState(lumiere!, partial)).toBe('indeterminate')
    expect(groupState(lumiere!, toggleGroup(partial, lumiere!))).toBe('checked')
  })

  it('ignores the sold-out line when deciding a group’s state (F5)', () => {
    // 품절을 세면 그 그룹의 체크박스는 영원히 절반만 켜진 채로 남고, 채우려는
    // 사람은 방법이 없다.
    const chosen = new Set(nodestep!.items.filter(isSelectable).map((item) => item.id))

    expect(groupState(nodestep!, chosen)).toBe('checked')
  })

  it('never selects a sold-out line, however it is asked', () => {
    expect(toggleItem(new Set(), soldOut).has(soldOut.id)).toBe(false)
    expect(toggleGroup(new Set(), nodestep!).has(soldOut.id)).toBe(false)
    expect(toggleAll(new Set(), cart).has(soldOut.id)).toBe(false)
  })

  it('clears everything when the top box was fully on', () => {
    expect(toggleAll(initialSelection(cart), cart)).toEqual(new Set())
  })
})

describe('응답이 새로 왔을 때', () => {
  it('drops ids that are no longer in the cart', () => {
    // 없는 줄의 id 가 남으면 합계가 그 줄을 계속 세거나 세지 않는다 — 어느 쪽이든
    // 화면과 다른 숫자다.
    const smaller: CartResponse = { ...cart, groups: [lumiere!] }

    expect(reconcile(smaller, initialSelection(cart))).toEqual(
      new Set(lumiere!.items.map((item) => item.id)),
    )
  })

  it('does not select a line that has just appeared', () => {
    // 사람이 고른 적이 없다.
    expect(reconcile(cart, new Set([coat.id]))).toEqual(new Set([coat.id]))
  })
})

describe('합계 (F2 · F4 · F6)', () => {
  it('counts only what was chosen', () => {
    const only = cartTotals(cart, new Set([coat.id]))

    expect(only.productAmount).toBe(189_000)
    expect(only.selectedCount).toBe(1)
  })

  it('follows a quantity change', () => {
    // 수량 2 → 상품금액이 두 배다. 화면이 다시 곱하는 것이 아니라 계산 엔진이 낸다.
    expect(cartTotals(cart, new Set([knit.id])).productAmount).toBe(118_000 * 2)
  })

  it('charges shipping per seller, and waives it at the threshold', () => {
    const both = cartTotals(cart, initialSelection(cart))
    const lumiereShare = both.groups.get(lumiere!.sellerId)
    const nodeShare = both.groups.get(nodestep!.sellerId)

    // 루미에르는 5만원을 넘겼으므로 무료, 노드스텝은 무료 조건이 없어 늘 2,500원.
    expect(lumiereShare?.shippingFee).toBe(0)
    expect(nodeShare?.shippingFee).toBe(2_500)
    expect(both.shippingFee).toBe(2_500)
  })

  it('says how much more would earn free shipping, and stops saying it once earned', () => {
    // 조건을 채우면 사라진다 (F6). 남은 금액을 계속 보여 주면 이미 무료인 사람에게
    // 「더 담으라」고 말하게 된다.
    const cheap: CartResponse = {
      ...cart,
      groups: [{ ...lumiere!, items: [{ ...coat, price: 30_000 }] }],
    }

    expect(cartTotals(cheap, new Set([coat.id])).groups.get(lumiere!.sellerId)).toMatchObject({
      freeShippingRemaining: 20_000,
      shippingFee: 3_000,
    })
    expect(
      cartTotals(cart, initialSelection(cart)).groups.get(lumiere!.sellerId)?.freeShippingRemaining,
    ).toBeNull()
  })

  it('says nothing about free shipping for a seller who has no such rule', () => {
    expect(
      cartTotals(cart, initialSelection(cart)).groups.get(nodestep!.sellerId)
        ?.freeShippingRemaining,
    ).toBeNull()
  })

  it('charges nothing for a group nobody chose from', () => {
    const only = cartTotals(cart, new Set([coat.id]))

    expect(only.groups.get(nodestep!.sellerId)).toMatchObject({
      productAmount: 0,
      shippingFee: 0,
      freeShippingRemaining: null,
    })
  })

  it('is all zeroes for an empty cart', () => {
    expect(cartTotals(emptyCart, new Set())).toMatchObject({
      productAmount: 0,
      shippingFee: 0,
      paidAmount: 0,
      selectedCount: 0,
    })
  })
})
