/**
 * 변동 감지 (TASK-0045 F4 · F5). 입력 → 출력, 데이터베이스 없음 (Q5 순수 로직).
 *
 * 이 판단이 틀리면 실패하지 않는다 — 화면이 **아무 말도 하지 않고**, 사람은
 * 어제 본 가격으로 결제하는 줄 안다. 그래서 경계마다 짚는다.
 */

import { describe, expect, it } from 'vitest'

import type { CartLineState } from './cart-notices.js'
import { noticesFor } from './cart-notices.js'

function line(overrides: Partial<CartLineState> = {}): CartLineState {
  return {
    quantity: 2,
    priceAtAdded: 10_000,
    price: 10_000,
    stock: 5,
    sellable: true,
    ...overrides,
  }
}

describe('아무것도 안 바뀌었으면', () => {
  it('says nothing', () => {
    expect(noticesFor(line())).toEqual([])
  })

  it('says nothing when the stock is exactly what was asked for', () => {
    // 경계: 재고 2, 담은 수량 2 는 살 수 있다.
    expect(noticesFor(line({ stock: 2, quantity: 2 }))).toEqual([])
  })
})

describe('가격', () => {
  it('reports a rise', () => {
    expect(noticesFor(line({ price: 12_000 }))).toEqual(['price_increased'])
  })

  it('reports a fall too — it is the welcome direction', () => {
    expect(noticesFor(line({ price: 8_000 }))).toEqual(['price_decreased'])
  })
})

describe('재고', () => {
  it('reports sold out', () => {
    expect(noticesFor(line({ stock: 0 }))).toEqual(['sold_out'])
  })

  it('reports a shortfall, which is not the same thing', () => {
    // 품절은 뺄 일이고 부족은 수량을 낮출 일이다.
    expect(noticesFor(line({ stock: 1, quantity: 2 }))).toEqual(['stock_reduced'])
  })

  it('does not report both for the same line', () => {
    expect(noticesFor(line({ stock: 0, quantity: 2 }))).not.toContain('stock_reduced')
  })
})

describe('둘 다 바뀌었으면', () => {
  it('says both — they are two different decisions', () => {
    expect(noticesFor(line({ price: 12_000, stock: 1 }))).toEqual([
      'price_increased',
      'stock_reduced',
    ])
  })
})

describe('팔지 않는 것', () => {
  it('says only that, whatever else changed', () => {
    // 「품절이고 가격이 올랐습니다」는 살 수 없는 물건에 대한 두 줄이고, 사람이 할
    // 일은 빼는 것 하나다.
    expect(noticesFor(line({ sellable: false, price: 99_000, stock: 0 }))).toEqual(['unavailable'])
  })
})
