/**
 * 결제수단 목록과 결제창의 주문 이름 (TASK-0055 4.1 · 4.5 · R3).
 *
 * 순수 함수라 입력과 출력뿐이다. 여기 있는 것이 화면 안에 흩어져 있으면 「토스가
 * 언제 나오는가」와 「무엇이 기본으로 골라지는가」를 물어볼 자리가 사라지고, 그 두
 * 질문이 곧 4.1 과 R3 이다.
 */

import { shopperCards } from '@shopping/api-mocks'
import { describe, expect, it } from 'vitest'

import { defaultMethod, methodById, methodId, paymentMethods } from '@/lib/payment/methods'
import { checkoutOrderName, TOSS_ORDER_NAME_MAX } from '@/lib/payment/order-name'
import type { IssuedCard } from '@/lib/payment/payment-api'

const LABELS = { more: '{name} 외 {count}건', single: '{name}' } as const

function card(overrides: Partial<IssuedCard> = {}): IssuedCard {
  const [first] = shopperCards.cards

  if (first === undefined) throw new Error('shopperCards 가 비어 있다')

  return { ...first, ...overrides }
}

/** 주문서 하나를 흉내 낸 최소한. 이 함수가 보는 것은 줄과 그 이름뿐이다. */
function checkoutOf(names: readonly string[]) {
  return {
    sellerOrders: [
      {
        items: names.map((productName) => ({ snapshot: { productName } })),
      },
    ],
  } as unknown as Parameters<typeof checkoutOrderName>[0]
}

describe('결제수단 목록 (4.1)', () => {
  it('has no Toss row when there is no client key', () => {
    const methods = paymentMethods([card()], false)

    // 비활성으로도 없다. 키가 없는 것은 방문자가 어찌할 수 없는 우리 설정이라,
    // 정지된 카드처럼 「보여 주되 고를 수 없게」 둘 이유가 없다.
    expect(methods.map((method) => method.kind)).toEqual(['card'])
  })

  it('puts Toss last, after every card (R3)', () => {
    const methods = paymentMethods([card({ id: 'a' }), card({ id: 'b' })], true)

    expect(methods.map((method) => method.kind)).toEqual(['card', 'card', 'toss'])
  })

  it('is empty for somebody with no cards and no Toss', () => {
    expect(paymentMethods([], false)).toEqual([])
  })

  it('identifies a card by its own id and Toss by a fixed one', () => {
    const [only, toss] = paymentMethods([card({ id: 'card-1' })], true)

    expect(only === undefined ? null : methodId(only)).toBe('card-1')
    expect(toss === undefined ? null : methodId(toss)).toBe('toss')
  })
})

describe('처음에 골라 둘 것 (R3)', () => {
  it('is the first usable card, even when Toss is on offer', () => {
    const methods = paymentMethods([card({ id: 'card-1' })], true)

    // 가상 카드가 기본이고 토스가 선택지다. 데모 방문자에게 익숙한 것은 우리가
    // 발급해 준 카드 쪽이다.
    expect(defaultMethod(methods)).toEqual({ card: card({ id: 'card-1' }), kind: 'card' })
  })

  it('skips a card that cannot be chosen', () => {
    const methods = paymentMethods(
      [card({ id: 'stopped', status: 'SUSPENDED' }), card({ id: 'live' })],
      false,
    )

    expect(defaultMethod(methods)).toEqual({ card: card({ id: 'live' }), kind: 'card' })
  })

  it('falls to Toss when every card is stopped', () => {
    const methods = paymentMethods([card({ id: 'stopped', status: 'SUSPENDED' })], true)

    expect(defaultMethod(methods)).toEqual({ kind: 'toss' })
  })

  it('is nothing at all when there is nothing to choose', () => {
    expect(defaultMethod(paymentMethods([card({ status: 'SUSPENDED' })], false))).toBeNull()
  })
})

describe('id 로 되찾기', () => {
  const methods = paymentMethods([card({ id: 'card-1' })], true)

  it('finds the card and the Toss row', () => {
    expect(methodById(methods, 'card-1')).toEqual({ card: card({ id: 'card-1' }), kind: 'card' })
    expect(methodById(methods, 'toss')).toEqual({ kind: 'toss' })
  })

  it('is null for nothing chosen, and for an id that left the list', () => {
    // 카드를 지운 뒤 목록이 다시 오면 골라 둔 id 가 사라진다. 그때 화면은 기본값으로
    // 돌아가야지, 없는 카드로 결제를 걸어서는 안 된다.
    expect(methodById(methods, null)).toBeNull()
    expect(methodById(methods, 'gone')).toBeNull()
  })
})

describe('결제창에 뜨는 주문 이름', () => {
  it('is just the product when there is one line', () => {
    expect(checkoutOrderName(checkoutOf(['울 롱코트']), LABELS)).toBe('울 롱코트')
  })

  it('counts lines, not quantities', () => {
    // 같은 옷 세 벌을 산 사람에게 「외 2건」은 다른 물건 둘이 더 있다는 뜻으로
    // 읽히고, 그것은 사실이 아니다.
    expect(checkoutOrderName(checkoutOf(['울 롱코트', '캐시미어 니트', '울 머플러']), LABELS)).toBe(
      '울 롱코트 외 2건',
    )
  })

  it('is empty for an empty checkout rather than a sentence about nothing', () => {
    expect(checkoutOrderName(checkoutOf([]), LABELS)).toBe('')
  })

  it('stays inside the length Toss accepts', () => {
    const long = '가'.repeat(200)

    // 넘으면 저쪽이 요청을 거절하고, 그 거절은 사용자에게 「결제창이 안 뜬다」로만
    // 보인다. 상품명이 긴 옷 한 벌이면 충분히 닿는 길이다.
    expect(checkoutOrderName(checkoutOf([long]), LABELS)).toHaveLength(TOSS_ORDER_NAME_MAX)
  })
})
