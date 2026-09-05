import type { DemoCarrierCode } from '@shopping/shared'
import {
  demoCarrierCodes,
  demoCarrierNames,
  shipmentSchema,
  shipmentStatuses,
  TRACKING_NUMBER_PREFIX,
  trackingEventKinds,
} from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  carrierFrom,
  carrierNameOf,
  furthestShipmentStatus,
  hasDemoTrackingFormat,
  isKnownCarrierCode,
  pickupHubOf,
  shipmentStatusAfter,
  TRACKING_NUMBER_DIGITS,
  TRACKING_NUMBER_PATTERN,
  trackingEventDescriptionOf,
  trackingNumberFrom,
} from './shipment-rules.js'

/**
 * 가상 운송장의 순수 판단, 남김없이 (TASK-0061 6.2 — Q5 강화, 분기 100%).
 *
 * **여기서 지켜야 하는 성질은 하나다: 발급한 번호가 진짜 운송장과 구분된다** (F2 · R1).
 * 그것이 무너지는 방식은 「조금 다른 번호」가 아니라 **접두어가 없는 번호**이고, 그런
 * 번호는 아무 검사도 빨갛게 만들지 않은 채 화면에 실려 나간다 — 알아차리는 사람은
 * 그것을 실제 택배사 조회창에 넣어 본 사람뿐이다.
 *
 * 그래서 형식은 세 번 재고(생성 · 판정 · 계약), 운송사 목록은 **실제 상표가 아닌
 * 것**까지 잰다 (F7).
 */

/** 발급기가 받는 바이트열. 자리마다 다른 값이라 자릿수가 섞이면 눈에 띈다. */
const BYTES = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])

describe('운송장 번호', () => {
  it('starts with the prefix that no real waybill has', () => {
    expect(trackingNumberFrom('GA', BYTES).startsWith(`${TRACKING_NUMBER_PREFIX}-`)).toBe(true)
  })

  it('lays the bytes out as DEMO-{carrier}-{12 digits}', () => {
    expect(trackingNumberFrom('GA', BYTES)).toBe('DEMO-GA-012345678901')
  })

  it('needs exactly the declared number of bytes to fill the digits', () => {
    // 서비스가 넘길 바이트 수와 형식이 갈라지면 자리가 빈 번호가 나오고, 그것은
    // DB 의 CHECK 에 닿기 전까지 아무 소리도 내지 않는다.
    expect(BYTES).toHaveLength(TRACKING_NUMBER_DIGITS)
  })

  it('emits a digit for every possible byte value', () => {
    // 바이트 하나가 자릿수 밖으로 나가면 번호가 형식을 잃는다. 256 가지를 전부 넣어
    // 보는 편이 「% 10 이니까 괜찮다」는 짐작보다 싸다.
    for (let byte = 0; byte < 256; byte += 1) {
      const number = trackingNumberFrom('HD', new Uint8Array(TRACKING_NUMBER_DIGITS).fill(byte))

      expect(number).toMatch(TRACKING_NUMBER_PATTERN)
    }
  })

  it('issues a number every carrier can carry', () => {
    for (const code of demoCarrierCodes) {
      expect(hasDemoTrackingFormat(trackingNumberFrom(code, BYTES))).toBe(true)
    }
  })

  it('agrees with the contract the front-ends parse', () => {
    // C3 의 절반. 계약이 형식을 단언하므로(`shipmentSchema.trackingNumber`), 두 곳이
    // 갈라지면 **서버가 만든 번호를 서버의 계약이 거절한다.** 그 사실은 여기서
    // 알아차리는 편이 통합 검사에서 알아차리는 것보다 싸다.
    const parsed = shipmentSchema.shape.trackingNumber.safeParse(trackingNumberFrom('SB', BYTES))

    expect(parsed.success).toBe(true)
  })
})

describe('형식 판정', () => {
  it('accepts what the generator produces', () => {
    expect(hasDemoTrackingFormat('DEMO-GA-000000000001')).toBe(true)
  })

  it.each([
    // 접두어가 없다 — 실제 운송장처럼 보이는 번호가 정확히 이 모양이다.
    ['000000000001', '접두어 없음'],
    ['1234-GA-000000000001', '다른 접두어'],
    // 운송사 칸이 비었다. `carrierCode` 의 길이를 DB 가 따로 막는 이유이기도 하다.
    ['DEMO--000000000001', '운송사 없음'],
    ['DEMO-ga-000000000001', '소문자 운송사'],
    ['DEMO-GA-00000000001', '11자리'],
    ['DEMO-GA-0000000000012', '13자리'],
    ['DEMO-GA-00000000000A', '숫자가 아닌 자리'],
    [' DEMO-GA-000000000001', '앞 공백'],
    ['DEMO-GA-000000000001 ', '뒤 공백'],
  ])('refuses %s (%s)', (value) => {
    expect(hasDemoTrackingFormat(value)).toBe(false)
  })

  it('does not ask whether the carrier is one we know', () => {
    // 묻는 것은 「진짜 운송장과 구분되는가」다. 운송사가 하나 늘어난 날 예전 번호가
    // 갑자기 「우리 것이 아닌」 번호가 되면, 그 판정으로 무엇을 걸러도 뜻이 없다.
    expect(hasDemoTrackingFormat('DEMO-ZZ-000000000001')).toBe(true)
    expect(isKnownCarrierCode('ZZ')).toBe(false)
  })
})

describe('가상 운송사', () => {
  it('has three or four of them (TASK-0061 4장)', () => {
    expect(demoCarrierCodes.length).toBeGreaterThanOrEqual(3)
    expect(demoCarrierCodes.length).toBeLessThanOrEqual(4)
  })

  it('uses no real trademark (F7)', () => {
    // 실제 택배사 이름을 데이터에 쓰지 않는다 (CLAUDE.md 6장). 목록으로 재는 것은
    // 이름을 고치는 사람이 「그럴듯한 이름」을 찾다가 실제 상표에 닿기 쉬워서다.
    const forbidden = ['대한통운', '한진', '롯데', '우체국', '로젠', '경동', 'CJ', 'GS']
    const names = demoCarrierCodes.map((code) => carrierNameOf(code)).join(' ')

    for (const brand of forbidden) expect(names).not.toContain(brand)
  })

  it('names every code, and only the codes', () => {
    expect(Object.keys(demoCarrierNames).sort()).toEqual([...demoCarrierCodes].sort())
  })

  it('gives every carrier a pickup hub of its own', () => {
    const hubs = demoCarrierCodes.map((code) => pickupHubOf(code))

    // 같은 지명이 두 운송사에 붙으면 타임라인의 첫 줄이 아무것도 말하지 않는다.
    expect(new Set(hubs).size).toBe(demoCarrierCodes.length)
    for (const hub of hubs) expect(hub.length).toBeGreaterThan(0)
  })

  it('recognises the codes it knows', () => {
    for (const code of demoCarrierCodes) expect(isKnownCarrierCode(code)).toBe(true)
  })

  it.each(['', 'ZZ', 'ga', 'toString', '__proto__'])('refuses %o', (value) => {
    // `toString` 과 `__proto__` 는 프로토타입에서 오는 이름이다. `in` 으로 물으면
    // 참이 되고, 그러면 운송사가 아닌 것이 운송사가 된다.
    expect(isKnownCarrierCode(value)).toBe(false)
  })

  it('picks one from the bytes, and always a real one', () => {
    for (let byte = 0; byte < 256; byte += 1) {
      const picked: DemoCarrierCode = carrierFrom(Uint8Array.from([byte]))

      expect(demoCarrierCodes).toContain(picked)
    }
  })

  it('reaches every carrier over the byte range', () => {
    // 한 운송사에만 몰리면 목록이 여럿인 사실이 화면에 드러나지 않는다.
    const picked = new Set(
      Array.from({ length: 256 }, (_unused, byte) => carrierFrom(Uint8Array.from([byte]))),
    )

    expect(picked.size).toBe(demoCarrierCodes.length)
  })

  it('answers the same carrier for the same bytes', () => {
    expect(carrierFrom(Uint8Array.from([7, 7, 7]))).toBe(carrierFrom(Uint8Array.from([7, 7, 7])))
  })

  it('sums the bytes rather than reading one', () => {
    // 한 바이트만 보면 `randomBytes` 의 길이를 늘려도 고르는 폭이 넓어지지 않는다.
    expect(carrierFrom(Uint8Array.from([0, 1]))).toBe(carrierFrom(Uint8Array.from([1, 0])))
  })
})

describe('사건과 상태', () => {
  it('maps every kind to a status', () => {
    for (const kind of trackingEventKinds) {
      expect(shipmentStatuses).toContain(shipmentStatusAfter(kind))
    }
  })

  it('leaves a shipment READY right after pickup', () => {
    // 운송장은 발송과 함께 나오고 그 순간 집화가 남는다. `READY` 는 「아직 아무 일도
    // 없다」가 아니라 「받아 갔고 아직 간선에 오르지 않았다」다.
    expect(shipmentStatusAfter('PICKED_UP')).toBe('READY')
  })

  it('ends at DELIVERED', () => {
    expect(shipmentStatusAfter('DELIVERED')).toBe('DELIVERED')
  })

  it('moves the middle two along with the event', () => {
    expect(shipmentStatusAfter('IN_TRANSIT')).toBe('IN_TRANSIT')
    expect(shipmentStatusAfter('OUT_FOR_DELIVERY')).toBe('OUT_FOR_DELIVERY')
  })

  it('never lets the summary walk backwards (F6)', () => {
    // 늦게 도착한 사건이 상태를 되돌리면 「배송완료」를 본 사람의 화면이 「이동
    // 중」이 되고, 주문 쪽에는 되돌아가는 화살표가 없어 두 표가 다른 말을 한다.
    expect(furthestShipmentStatus('DELIVERED', 'IN_TRANSIT')).toBe('DELIVERED')
    expect(furthestShipmentStatus('OUT_FOR_DELIVERY', 'READY')).toBe('OUT_FOR_DELIVERY')
  })

  it('moves forward when the event is ahead', () => {
    expect(furthestShipmentStatus('READY', 'IN_TRANSIT')).toBe('IN_TRANSIT')
    expect(furthestShipmentStatus('OUT_FOR_DELIVERY', 'DELIVERED')).toBe('DELIVERED')
  })

  it('stays put when the same event arrives twice', () => {
    for (const status of shipmentStatuses) {
      expect(furthestShipmentStatus(status, status)).toBe(status)
    }
  })

  it('agrees with the order the contract declares', () => {
    // 순위표를 따로 두지 않고 계약의 순서를 읽는다. 그 순서가 뜻이라는 것을 여기서
    // 한 번 못 박아 두면, 계약의 배열이 뒤섞이는 날 이 검사가 먼저 빨개진다.
    const ladder = [...shipmentStatuses].reduce((furthest, status) =>
      furthestShipmentStatus(furthest, status),
    )

    expect(ladder).toBe('DELIVERED')
  })

  it('writes a sentence for every kind', () => {
    // 빈 문장은 `ShipmentTrackingEvent_text_check` 가 거절한다. 종류가 하나 늘고
    // 문장이 빠지면 그 거절은 사용자의 발송 요청 위에서 나타난다.
    for (const kind of trackingEventKinds) {
      expect(trackingEventDescriptionOf(kind).trim().length).toBeGreaterThan(0)
    }
  })
})
