/**
 * 렌더 없이 검증되는 부분 (QUALITY-GATES Q5 「순수 로직」).
 *
 * 여기 있는 규칙 셋 — 단계 번호, 단계의 자리, 이벤트 순서 — 이 틀리면 화면은
 * 조용히 거짓말을 한다. 「배송 출발」인데 3단계가 아니라 2단계를 굵게 그리거나,
 * 마지막 이벤트가 아닌 것에 「현재 위치」를 붙인다. 둘 다 눈으로는 그럴듯해
 * 보이므로 입력 → 출력으로 못박는다.
 */

import { describe, expect, it } from 'vitest'

import {
  latestTrackingEvent,
  SHIPMENT_STATUSES,
  shipmentStepIndex,
  sortTrackingEvents,
  stepStateAt,
  TRACKING_EVENT_KINDS,
  type TrackingEvent,
} from './shipment'

function event(id: string, occurredAt: string): TrackingEvent {
  return {
    description: `${id} 설명`,
    id,
    kind: 'IN_TRANSIT',
    location: '가상시 가상구',
    occurredAt,
  }
}

describe('계약', () => {
  it('상태 네 가지가 서버와 같은 순서다', () => {
    expect(SHIPMENT_STATUSES).toEqual(['READY', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'])
  })

  it('이벤트 종류 네 가지가 서버와 같다', () => {
    expect(TRACKING_EVENT_KINDS).toEqual([
      'PICKED_UP',
      'IN_TRANSIT',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ])
  })
})

describe('shipmentStepIndex', () => {
  it('상태를 배열의 자리로 옮긴다', () => {
    expect(shipmentStepIndex('READY')).toBe(0)
    expect(shipmentStepIndex('IN_TRANSIT')).toBe(1)
    expect(shipmentStepIndex('OUT_FOR_DELIVERY')).toBe(2)
    expect(shipmentStepIndex('DELIVERED')).toBe(3)
  })
})

describe('stepStateAt', () => {
  it('지난 단계는 done, 지금 단계는 current, 남은 단계는 upcoming', () => {
    expect(stepStateAt(0, 2)).toBe('done')
    expect(stepStateAt(1, 2)).toBe('done')
    expect(stepStateAt(2, 2)).toBe('current')
    expect(stepStateAt(3, 2)).toBe('upcoming')
  })

  it('READY 는 첫 단계가 현재이고 나머지가 전부 남는다', () => {
    expect(SHIPMENT_STATUSES.map((_status, index) => stepStateAt(index, 0))).toEqual([
      'current',
      'upcoming',
      'upcoming',
      'upcoming',
    ])
  })

  it('DELIVERED 는 마지막 단계가 현재이고 앞이 전부 끝났다', () => {
    expect(SHIPMENT_STATUSES.map((_status, index) => stepStateAt(index, 3))).toEqual([
      'done',
      'done',
      'done',
      'current',
    ])
  })
})

describe('sortTrackingEvents', () => {
  it('뒤섞여 와도 오래된 것부터 나열한다', () => {
    const sorted = sortTrackingEvents([
      event('c', '2026-09-05T18:20:00.000Z'),
      event('a', '2026-09-03T01:00:00.000Z'),
      event('b', '2026-09-04T09:30:00.000Z'),
    ])

    expect(sorted.map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('같은 시각이면 받은 순서를 지킨다', () => {
    const sorted = sortTrackingEvents([
      event('first', '2026-09-03T01:00:00.000Z'),
      event('second', '2026-09-03T01:00:00.000Z'),
    ])

    expect(sorted.map((item) => item.id)).toEqual(['first', 'second'])
  })

  it('원본을 건드리지 않는다', () => {
    const input = [event('b', '2026-09-04T09:30:00.000Z'), event('a', '2026-09-03T01:00:00.000Z')]

    sortTrackingEvents(input)

    expect(input.map((item) => item.id)).toEqual(['b', 'a'])
  })

  it('빈 목록은 빈 목록이다', () => {
    expect(sortTrackingEvents([])).toEqual([])
  })

  it('ISO 가 아닌 시각은 조용히 뒤로 밀리지 않고 즉시 터진다', () => {
    expect(() => sortTrackingEvents([event('a', '언젠가')])).toThrow(RangeError)
  })
})

describe('latestTrackingEvent', () => {
  it('정렬된 목록의 마지막이 「지금 여기」다', () => {
    const ordered = sortTrackingEvents([
      event('b', '2026-09-04T09:30:00.000Z'),
      event('a', '2026-09-03T01:00:00.000Z'),
    ])

    expect(latestTrackingEvent(ordered)?.id).toBe('b')
  })

  it('이벤트가 없으면 null 이다 — 발송 전에는 「여기」가 없다', () => {
    expect(latestTrackingEvent([])).toBeNull()
  })
})
