/**
 * 기간과 증감률의 순수 판단 (TASK-0082 F6).
 *
 * **틀려도 조용하다.** 기간을 하루 어긋나게 잡으면 화면은 멀쩡한 그래프를 그리고,
 * 증감률의 분모를 잘못 고르면 그럴듯한 퍼센트가 하나 뜬다. `vitest.config.mjs` 가
 * 이 모듈을 분기 100% 로 잡는 이유다.
 *
 * 아래에서 가장 중요한 절은 **「지난 기간 매출이 0원일 때」**다. 그 갈래가 없으면
 * 화면은 `Infinity%` 를 그리거나, 더 나쁘게는 그것을 반올림해 「100% 늘었다」고
 * 말한다.
 */

import { REVENUE_MAX_DAYS } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  dayCount,
  defaultRevenuePeriod,
  growthOf,
  kstDay,
  periodProblem,
  REVENUE_DEFAULT_DAYS,
  shiftDay,
} from '@/lib/revenue/revenue-console'

describe('kstDay', () => {
  it('reads the Seoul calendar date, not UTC', () => {
    // 서울에서는 이미 9월 7일이지만 UTC 로는 아직 9월 6일이다. 「오늘」을 UTC 로
    // 읽으면 자정 직후의 판매자가 어제 화면을 본다.
    expect(kstDay(new Date('2026-09-06T15:30:00.000Z'))).toBe('2026-09-07')
    expect(kstDay(new Date('2026-09-06T14:30:00.000Z'))).toBe('2026-09-06')
  })
})

describe('shiftDay', () => {
  it('crosses month and year boundaries', () => {
    expect(shiftDay('2026-09-01', -1)).toBe('2026-08-31')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('defaultRevenuePeriod', () => {
  it('ends today and spans the default length, both ends included', () => {
    const period = defaultRevenuePeriod(new Date('2026-09-06T03:00:00.000Z'))

    expect(period.to).toBe('2026-09-06')
    expect(dayCount(period)).toBe(REVENUE_DEFAULT_DAYS)
  })
})

describe('dayCount', () => {
  it('counts both ends', () => {
    expect(dayCount({ from: '2026-09-01', to: '2026-09-01' })).toBe(1)
    expect(dayCount({ from: '2026-09-01', to: '2026-09-03' })).toBe(3)
  })
})

describe('periodProblem', () => {
  it('accepts a period the API will answer', () => {
    expect(periodProblem({ from: '2026-08-08', to: '2026-09-06' })).toBeNull()
  })

  it('names a reversed range rather than asking for it', () => {
    // 서버는 이 질의에 0원으로 답하고 그것은 틀린 답이 아니다. 하지만 판매자가
    // 보는 것은 「매출이 없다」이지 「날짜를 거꾸로 골랐다」가 아니다.
    expect(periodProblem({ from: '2026-09-06', to: '2026-09-01' })).toBe('reversed')
  })

  it('names a range longer than the contract allows', () => {
    const from = '2026-01-01'

    expect(periodProblem({ from, to: shiftDay(from, REVENUE_MAX_DAYS - 1) })).toBeNull()
    // 하루만 더 넘겨도 서버는 400 으로 답한다. 그것을 「알 수 없는 오류」로 옮기지
    // 않고 여기서 말한다.
    expect(periodProblem({ from, to: shiftDay(from, REVENUE_MAX_DAYS) })).toBe('tooLong')
  })
})

describe('growthOf', () => {
  it('says how much it grew', () => {
    expect(growthOf(1_500_000, 1_200_000)).toEqual({
      direction: 'up',
      kind: 'ratio',
      percent: 25,
    })
  })

  it('says how much it shrank, with the sign in the direction', () => {
    // 퍼센트는 음수 그대로다 — 화면이 절댓값을 그리고 방향은 문장이 말한다.
    expect(growthOf(900_000, 1_200_000)).toEqual({
      direction: 'down',
      kind: 'ratio',
      percent: -25,
    })
  })

  it('rounds to one decimal', () => {
    expect(growthOf(1_000_001, 3_000_000)).toEqual({
      direction: 'down',
      kind: 'ratio',
      percent: -66.7,
    })
  })

  it('calls an unchanged period flat', () => {
    expect(growthOf(1_200_000, 1_200_000)).toEqual({
      direction: 'flat',
      kind: 'ratio',
      percent: 0,
    })
  })

  it('keeps the arrow when the rounded percentage is zero', () => {
    // 0.04% 늘어난 것을 「0.0%」로 적더라도 방향까지 「변화 없음」으로 만들면 두
    // 표시가 서로를 부정한다. 방향은 반올림 전의 차이가 정한다.
    expect(growthOf(1_000_400, 1_000_000)).toEqual({
      direction: 'up',
      kind: 'ratio',
      percent: 0,
    })
  })

  describe('when the previous period sold nothing', () => {
    it('has no growth rate at all', () => {
      // 0으로 나눈 값이 아니다. 「없다」다 — 계약이 비율 대신 숫자만 보내는 이유이고,
      // 화면은 이 갈래에서 퍼센트 대신 문장을 그린다.
      expect(growthOf(1_500_000, 0)).toEqual({ kind: 'none' })
    })

    it('says the same thing when this period sold nothing either', () => {
      expect(growthOf(0, 0)).toEqual({ kind: 'none' })
    })
  })
})
