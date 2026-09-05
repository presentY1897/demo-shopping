/**
 * 주문번호 (TASK-0049 F7). 입력 → 출력, 분기 100%.
 */

import { describe, expect, it } from 'vitest'

import { ORDER_NUMBER_PATTERN } from '@shopping/shared'

import { orderDateOf, orderNumberOf, suffixFrom } from './order-number.js'

const BYTES = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7])

describe('날짜 부분', () => {
  it('is the Seoul date, not the UTC one', () => {
    // 한국 시각 9월 5일 오전 6시. UTC 로는 아직 9월 4일이다.
    expect(orderDateOf(new Date('2026-09-04T21:00:00.000Z'))).toBe('20260905')
  })

  it('pads the month and the day', () => {
    expect(orderDateOf(new Date('2026-01-02T00:00:00.000Z'))).toBe('20260102')
  })
})

describe('난수 부분', () => {
  it('maps each byte onto the alphabet', () => {
    expect(suffixFrom(BYTES)).toBe('01234567')
  })

  it('wraps past the end of the alphabet without favouring its start', () => {
    // 256 은 32의 배수라 나머지에 치우침이 없다. 32와 0이 같은 글자가 되는 것이
    // 그 성질의 관찰 가능한 형태다.
    expect(suffixFrom(Uint8Array.from([32, 64, 224]))).toBe('000')
    expect(suffixFrom(Uint8Array.from([31, 63, 255]))).toBe('ZZZ')
  })

  it('never emits a character a person can misread', () => {
    const every = suffixFrom(Uint8Array.from({ length: 256 }, (_unused, index) => index))

    expect(every).not.toMatch(/[ILOU]/u)
  })
})

describe('주문번호', () => {
  it('matches the shape the database enforces', () => {
    // 같은 형식을 `Order_orderNumber_format_check` 가 DB 에서 지킨다. 두 벌인
    // 것이 아니라, 정규식이 계약에 하나 있고 양쪽이 그것을 본다.
    expect(orderNumberOf(new Date('2026-09-05T00:00:00.000Z'), BYTES)).toMatch(ORDER_NUMBER_PATTERN)
  })

  it('reads as the date it was placed', () => {
    expect(orderNumberOf(new Date('2026-09-05T00:00:00.000Z'), BYTES)).toBe('20260905-01234567')
  })
})
