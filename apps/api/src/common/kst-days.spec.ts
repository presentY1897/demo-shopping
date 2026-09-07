/**
 * KST 날짜 산술 (TASK-0082 · TASK-0092).
 *
 * 두 화면이 이 파일 하나를 쓴다. 그래서 여기가 틀리면 판매자가 본 「어제 매출」과
 * 관리자가 본 「어제 거래액」이 **함께** 틀리고, 둘이 서로를 검증해 주지 못한다.
 */

import { describe, expect, it } from 'vitest'

import {
  dayIndexOf,
  daySpan,
  fillDays,
  kstDate,
  previousRange,
  rangeOf,
  shiftDate,
} from './kst-days'

const NOW = new Date('2026-03-10T12:00:00.000Z')

describe('kstDate', () => {
  /**
   * **이 검사가 이 파일이 존재하는 이유다.** UTC 로 자르면 한국 시간 아침 9시
   * 이전의 주문이 전날로 들어가고, 표를 보는 사람은 매일 아침 매출이 사라졌다
   * 나타나는 것을 본다.
   */
  it('puts the small hours of a Korean morning on the right day', () => {
    // KST 로 3월 11일 오전 8시 = UTC 3월 10일 23시.
    expect(kstDate(new Date('2026-03-10T23:00:00.000Z'))).toBe('2026-03-11')
    expect(kstDate(new Date('2026-03-10T14:59:59.999Z'))).toBe('2026-03-10')
    // 자정 직후.
    expect(kstDate(new Date('2026-03-10T15:00:00.000Z'))).toBe('2026-03-11')
  })
})

describe('shiftDate · dayIndexOf · daySpan', () => {
  it('crosses a month boundary', () => {
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDate('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('crosses a leap day', () => {
    expect(shiftDate('2028-03-01', -1)).toBe('2028-02-29')
  })

  it('counts an inclusive span', () => {
    expect(daySpan('2026-03-10', '2026-03-10')).toBe(1)
    expect(daySpan('2026-03-01', '2026-03-31')).toBe(31)
  })

  it('is monotonic across a year boundary', () => {
    expect(dayIndexOf('2027-01-01') - dayIndexOf('2026-12-31')).toBe(1)
  })
})

describe('rangeOf', () => {
  const options = { defaultDays: 30, maxDays: 90 }

  it('ends today and runs back the default when nothing was asked', () => {
    expect(rangeOf({}, NOW, options)).toEqual({
      from: '2026-02-09',
      to: '2026-03-10',
      dayCount: 30,
    })
  })

  it('keeps a range the caller chose', () => {
    expect(rangeOf({ from: '2026-03-01', to: '2026-03-07' }, NOW, options)).toEqual({
      from: '2026-03-01',
      to: '2026-03-07',
      dayCount: 7,
    })
  })

  /** 던지지 않는다 — 읽기이고, 500 은 사람에게 무엇이 잘못됐는지 못 알려준다. */
  it('folds a backwards range into a single day instead of failing', () => {
    expect(rangeOf({ from: '2026-03-31', to: '2026-03-01' }, NOW, options)).toEqual({
      from: '2026-03-01',
      to: '2026-03-01',
      dayCount: 1,
    })
  })

  /** 상한이 없으면 한 요청이 몇 년치를 하루씩 그린다. 최근을 남긴다. */
  it('trims an over-long range from the far end', () => {
    const trimmed = rangeOf({ from: '2020-01-01', to: '2026-03-10' }, NOW, options)

    expect(trimmed).toEqual({ from: '2025-12-11', to: '2026-03-10', dayCount: 90 })
  })

  it('takes only the start when the end was left open', () => {
    expect(rangeOf({ from: '2026-03-08' }, NOW, options)).toEqual({
      from: '2026-03-08',
      to: '2026-03-10',
      dayCount: 3,
    })
  })

  it('runs back from a chosen end', () => {
    expect(rangeOf({ to: '2026-01-30' }, NOW, options)).toEqual({
      from: '2026-01-01',
      to: '2026-01-30',
      dayCount: 30,
    })
  })
})

describe('previousRange', () => {
  /**
   * 「직전 같은 기간」이지 「지난달」이 아니다. 7일을 보는 사람에게 지난달과의 비교를
   * 내밀면 그 수는 화면의 어느 것과도 짝이 맞지 않는다.
   */
  it('is the same length, ending the day before', () => {
    expect(previousRange({ from: '2026-03-08', to: '2026-03-10', dayCount: 3 })).toEqual({
      from: '2026-03-05',
      to: '2026-03-07',
      dayCount: 3,
    })
  })

  it('does not overlap the range it precedes', () => {
    const range = { from: '2026-03-01', to: '2026-03-31', dayCount: 31 }

    expect(daySpan(previousRange(range).to, range.from)).toBe(2)
  })

  it('handles a single day', () => {
    expect(previousRange({ from: '2026-03-10', to: '2026-03-10', dayCount: 1 })).toEqual({
      from: '2026-03-09',
      to: '2026-03-09',
      dayCount: 1,
    })
  })
})

describe('fillDays', () => {
  const empty = (date: string) => ({ date, amount: 0 })

  /** 빈 날을 빼면 「이 주에 3일 쉬었다」가 「매출이 완만했다」로 보인다. */
  it('puts a zero where nothing happened', () => {
    const filled = fillDays([{ date: '2026-03-02', amount: 500 }], '2026-03-01', 3, empty)

    expect(filled).toEqual([
      { date: '2026-03-01', amount: 0 },
      { date: '2026-03-02', amount: 500 },
      { date: '2026-03-03', amount: 0 },
    ])
  })

  it('drops a row outside the window rather than shifting it in', () => {
    const filled = fillDays([{ date: '2026-02-27', amount: 900 }], '2026-03-01', 2, empty)

    expect(filled).toEqual([
      { date: '2026-03-01', amount: 0 },
      { date: '2026-03-02', amount: 0 },
    ])
  })

  it('returns exactly the asked-for number of days', () => {
    expect(fillDays([], '2026-03-01', 31, empty)).toHaveLength(31)
  })
})
