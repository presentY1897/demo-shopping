import type { OrderStatus } from '@shopping/shared'
import { orderStatuses, sellerOrderSummarySchema } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  maskRecipientName,
  SELLER_ORDER_ACTION_REQUIRED_STATUSES,
  SELLER_ORDER_NEW_STATUSES,
  sellerOrderHeadline,
  sellerOrderSummaryOf,
} from './seller-order-console.js'

/**
 * 판매자 콘솔의 순수 판단, 남김없이 (TASK-0060 6.2 — Q5 강화, 분기 100%).
 *
 * 셋 다 **틀려도 빨간 검사가 되지 않는** 종류라 여기서 잰다.
 *
 * - 마스킹이 한 칸 어긋나면 목록 응답에 이름이 그대로 실려 나가는데, 화면은 정상으로
 *   보인다. 알아차리는 사람은 응답 본문을 열어 본 사람뿐이다.
 * - 뱃지의 상태 집합이 한 칸 넓으면 판매자가 할 일이 없는데 「3건 대기」가 떠 있고,
 *   그 뱃지는 영영 줄지 않는다 — 줄지 않는 뱃지는 곧 아무도 안 보는 뱃지다.
 * - 0건인 상태를 빠뜨리면 탭이 숫자를 잃고, 화면은 「0건」과 「아직 못 읽었다」를
 *   구분할 수 없게 된다.
 */

describe('수령인 이름 마스킹 (F6)', () => {
  it.each([
    ['홍길동', '홍*동'],
    ['김철수', '김*수'],
    ['남궁길동', '남**동'],
    ['제갈공명이', '제***이'],
  ])('masks the middle of %s', (name, masked) => {
    expect(maskRecipientName(name)).toBe(masked)
  })

  it('hides the second character of a two-character name', () => {
    // 끝을 남기면 `홍동` → `홍동` 이 되어 아무것도 가리지 않는다. 두 글자 이름은
    // 이 저장소의 시드에도 있고, 그때만 마스킹이 조용히 없어지면 안 된다.
    expect(maskRecipientName('홍동')).toBe('홍*')
  })

  it('leaves a one-character name alone', () => {
    // 통째로 `*` 로 바꾸면 「이름이 있었다」는 사실까지 지워지고, 목록에서 그 줄만
    // 다른 종류로 보인다.
    expect(maskRecipientName('홍')).toBe('홍')
  })

  it('answers empty for an empty name', () => {
    expect(maskRecipientName('')).toBe('')
    expect(maskRecipientName('   ')).toBe('')
  })

  it('counts code points, not code units', () => {
    // UTF-16 코드 유닛으로 자르면 서로게이트 쌍이 반으로 갈려 깨진 글자가 남는다.
    // 이름 칸에 이모지가 들어오는 것은 데모 계정에서 실제로 일어난다.
    expect(maskRecipientName('😀길동')).toBe('😀*동')
    expect([...maskRecipientName('😀길동')]).toHaveLength(3)
  })

  it('always hides something once there is something to hide', () => {
    for (const name of ['홍길동', '홍동', 'Kim', 'Alexander Kim', '김', '가나다라마바사']) {
      const masked = maskRecipientName(name)
      const characters = [...name.trim()]

      if (characters.length <= 1) continue

      expect(masked).not.toBe(name)
      expect(masked).toContain('*')
      // 길이는 그대로여야 목록의 칸이 흔들리지 않는다.
      expect([...masked]).toHaveLength(characters.length)
    }
  })
})

describe('목록의 제목', () => {
  it('takes the first product name', () => {
    expect(sellerOrderHeadline(['울 코트', '캐시미어 머플러'])).toBe('울 코트')
  })

  it('answers an empty string for a share with no items', () => {
    // `null` 을 만들지 않는 것은 화면이 「제목이 없다」와 「제목을 못 읽었다」를
    // 구분할 이유가 없기 때문이다.
    expect(sellerOrderHeadline([])).toBe('')
  })

  it('does not compose 「외 N건」 itself', () => {
    // 개수는 `itemCount` 로 따로 나가고 문장은 화면이 만든다 — 그 문장은 로케일마다
    // 다르고, 서버가 만들면 메시지 파일 밖에 한국어가 생긴다.
    expect(sellerOrderHeadline(['울 코트', 'A', 'B'])).toBe('울 코트')
  })
})

describe('뱃지가 세는 것 (2장)', () => {
  it('fills every status with a zero', () => {
    const summary = sellerOrderSummaryOf([])

    for (const status of orderStatuses) expect(summary.counts[status]).toBe(0)
  })

  it('produces what the contract declares', () => {
    // C3 의 절반. 상태가 하나 늘고 `ZERO_COUNTS` 를 안 고치면 컴파일이 막지만,
    // 계약이 요구하는 **전 상태 존재**는 파싱이 재는 편이 확실하다.
    const parsed = sellerOrderSummarySchema.safeParse(
      sellerOrderSummaryOf([{ status: 'PAID', count: 2 }]),
    )

    expect(parsed.success).toBe(true)
  })

  it('adds the rows it was given', () => {
    const summary = sellerOrderSummaryOf([
      { status: 'PAID', count: 3 },
      { status: 'SHIPPED', count: 5 },
    ])

    expect(summary.counts.PAID).toBe(3)
    expect(summary.counts.SHIPPED).toBe(5)
    expect(summary.counts.PREPARING).toBe(0)
  })

  it('counts 신규 주문 as the ones the seller has not looked at', () => {
    const summary = sellerOrderSummaryOf([
      { status: 'PAID', count: 4 },
      { status: 'PREPARING', count: 2 },
      { status: 'PAYMENT_PENDING', count: 9 },
    ])

    // `PAYMENT_PENDING` 은 결제를 기다리는 중이다. 그것을 세면 결제창을 열어 놓고
    // 떠난 사람 수가 판매자의 할 일로 보인다.
    expect(summary.newOrders).toBe(4)
  })

  it('counts 처리 대기 as everything the seller must still act on', () => {
    const summary = sellerOrderSummaryOf([
      { status: 'PAID', count: 4 },
      { status: 'PREPARING', count: 2 },
      { status: 'SHIPPED', count: 7 },
      { status: 'DELIVERED', count: 6 },
    ])

    // 배송중·배송완료는 판매자가 지금 할 일이 없다. 세면 뱃지가 영영 줄지 않는다.
    expect(summary.actionRequired).toBe(6)
  })

  it('keeps 신규 주문 inside 처리 대기', () => {
    // 두 목록이 각각 자라다 보면 「신규가 대기보다 많은」 화면이 나온다. 그것은
    // 숫자가 틀린 것이 아니라 뜻이 갈린 것이고, 보는 사람은 둘 다 못 믿게 된다.
    for (const status of SELLER_ORDER_NEW_STATUSES) {
      expect(SELLER_ORDER_ACTION_REQUIRED_STATUSES).toContain(status)
    }
  })

  it('names only statuses the contract knows', () => {
    const named: readonly OrderStatus[] = [
      ...SELLER_ORDER_NEW_STATUSES,
      ...SELLER_ORDER_ACTION_REQUIRED_STATUSES,
    ]

    for (const status of named) expect(orderStatuses).toContain(status)
  })

  it('never counts a terminal state as pending', () => {
    // 종착 상태를 세면 뱃지가 영영 줄지 않는다. 목록으로 재는 것은 상태가 늘 때
    // 「대기인가」를 다시 묻게 하기 위해서다.
    for (const status of ['CONFIRMED', 'CANCELED', 'RETURNED', 'PAYMENT_FAILED'] as const) {
      expect(SELLER_ORDER_ACTION_REQUIRED_STATUSES).not.toContain(status)
    }
  })
})
