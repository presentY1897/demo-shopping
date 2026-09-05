/**
 * 주문서의 남은 시간 (TASK-0050 F2 · F3).
 *
 * 15분짜리 재고 예약을 화면이 매초 다시 묻는 자리다. 순수 함수이므로 시계를 옮기지
 * 않고 **경계 자체**를 고정할 수 있고, 고정해야 한다 — 이 함수가 한 틱 틀리면
 * 사람은 결제 버튼을 누른 뒤에야 예약이 풀린 것을 안다. 화면이 통째로 바뀌는 판단
 * (`expired`)과 마지막 3분에만 붙는 강조(`urgent`)가 여기서 갈린다.
 */

import { describe, expect, it } from 'vitest'

import { URGENT_THRESHOLD_MS, formatRemaining, remainingAt } from '@/lib/checkout/remaining'

/** 고정된 「지금」. `Date.now()` 를 부르면 경계 테스트가 실행 시각에 따라 흔들린다. */
const NOW = new Date('2026-09-05T00:00:00.000Z')

/** `NOW` 로부터 이만큼 남은 마감 시각. 모든 사례를 오프셋 하나로 읽게 한다. */
function left(ms: number) {
  return remainingAt(new Date(NOW.getTime() + ms), NOW)
}

describe('만료의 순간 (F2)', () => {
  it('calls the deadline instant itself expired', () => {
    // 예약은 서버가 그 시각에 푼다. 화면만 「아직 0:01 남았다」고 우기면 사람은
    // 살 수 있다고 믿고 결제를 눌렀다가 거절당한다 — 두 오류 중 안전한 쪽은
    // 한 틱 일찍 끝났다고 말하는 것이다.
    expect(left(0).expired).toBe(true)
  })

  it('is still running one millisecond before the deadline', () => {
    // 경계가 「≤ 0」이라는 말은 그 앞은 전부 살아 있다는 뜻이다. 여기까지 만료로
    // 접으면 마지막 1초가 화면에 존재하지 않게 된다.
    expect(left(1).expired).toBe(false)
  })

  it('does not count down past zero', () => {
    // 지난 시각이 들어와도 음수 분·초가 나오지 않는다. 「-1:-3」 같은 문자열은
    // 화면이 만들 수 있는 최악의 안내다. `urgent` 가 왜 켜진 채인지는 아래 참조.
    expect(left(-30_000)).toEqual({ minutes: 0, seconds: 0, urgent: true, expired: true })
  })
})

describe('마지막 3분의 강조 (F3)', () => {
  it('turns the emphasis on exactly at the threshold', () => {
    // 경계는 상수로 쓴다 — 임계값이 움직여도 이 테스트는 여전히 규칙을 설명한다.
    expect(left(URGENT_THRESHOLD_MS).urgent).toBe(true)
    expect(left(URGENT_THRESHOLD_MS + 1).urgent).toBe(false)
  })

  it('leaves the earlier part of the hold plain', () => {
    // R1 이 걱정한 것은 15분 내내 이어지는 압박이다. 강조는 마지막 3분에만 붙고,
    // 그 전에는 남은 시간이 그냥 적혀 있다.
    expect(left(15 * 60_000).urgent).toBe(false)
  })

  it('keeps the emphasis on once the hold has expired', () => {
    // 실제 동작을 고정한다. `urgent` 의 주석(「마지막 3분인가」)과 모듈 설명
    // (「강조는 마지막 3분에만」)만 읽으면 만료 뒤에는 꺼질 것 같지만, 만료 분기는
    // `urgent: true` 를 돌려준다. 이 쪽이 화면에는 맞다 — 0에 닿는 마지막 틱에서
    // 강조가 한 번 깜빡 꺼졌다가 만료 화면으로 넘어가는 일이 없다. 대신 「강조 =
    // 마지막 3분」이라고 읽고 `urgent` 만으로 살아 있는지 판단하면 틀린다.
    expect(left(0).urgent).toBe(true)
    expect(left(-1).urgent).toBe(true)
  })

  it('never prints 3:00 without the emphasis', () => {
    // 숫자와 강조가 어긋나면 사람은 둘 중 어느 쪽을 믿어야 할지 모른다. 초가
    // 올림이므로 「3:00」으로 찍히는 구간 전체가 임계값 이하여야 한다.
    const justInside = left(URGENT_THRESHOLD_MS - 999)

    expect(formatRemaining(justInside)).toBe('3:00')
    expect(justInside.urgent).toBe(true)
    expect(formatRemaining(left(URGENT_THRESHOLD_MS))).toBe('3:00')
  })
})

describe('초는 올림이다', () => {
  it('rounds a partial second up', () => {
    // 1.2초 남았을 때 「1초」로 내리면 0에 닿기 전에 만료된 것처럼 보인다.
    // 「2초」로 올리면 마지막 순간까지 숫자가 줄어드는 것이 보인다.
    expect(left(1_200).seconds).toBe(2)
  })

  it('never shows 0:00 while time is left', () => {
    // 올림의 진짜 이유. 시간이 남아 있는 한 화면의 숫자는 0이 아니고, 0은 오직
    // 만료와 같은 뜻이다.
    expect(formatRemaining(left(1))).toBe('0:01')
    expect(formatRemaining(left(999))).toBe('0:01')
  })

  it('carries the minute until the second is whole', () => {
    // 분이 넘어가는 지점은 59초처럼 보이는 순간이 아니라 정확히 59.000초다.
    // 올림이 그 앞을 전부 「1:00」으로 끌어올린다.
    expect(formatRemaining(left(60_000))).toBe('1:00')
    expect(formatRemaining(left(59_001))).toBe('1:00')
    expect(formatRemaining(left(59_000))).toBe('0:59')
  })

  it('splits a long remainder into minutes and seconds', () => {
    expect(left(725_000)).toMatchObject({ minutes: 12, seconds: 5 })
  })
})

describe('화면에 찍히는 문자열', () => {
  it('pads the seconds to two digits', () => {
    // 「12:5」는 시계로 읽히지 않고, 자릿수가 매초 바뀌면 옆 글자까지 흔들린다.
    expect(formatRemaining(left(725_000))).toBe('12:05')
  })

  it('leaves the minutes unpadded', () => {
    // 「03:00」이 아니다. 채우는 것은 초 쪽뿐이다.
    expect(formatRemaining(left(180_000))).toBe('3:00')
  })

  it('prints 0:00 for a hold that has run out', () => {
    // 만료 화면으로 넘어가는 사이에도 그려질 수 있는 값이다. 빈 문자열이나
    // 「NaN:NaN」이 순간적으로 보이는 일이 없어야 한다.
    expect(formatRemaining(left(0))).toBe('0:00')
    expect(formatRemaining(left(-1))).toBe('0:00')
  })
})
