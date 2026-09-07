/**
 * 화면이 그려지기 전에 내려진 판단들 (TASK-0092).
 *
 * 여기 있는 것은 전부 **틀려도 조용한** 것들이다: 기간이 하루 어긋나도 그래프는
 * 멀쩡하고, 증감의 분모가 0인 자리를 놓쳐도 퍼센트는 하나 그려지며, 처리 대기의
 * 링크가 틀려도 건수는 맞다. 그래서 `vitest.config.mjs` 가 이 모듈을 분기 100% 로
 * 잡고 있고, 여기가 그 분기들을 지나는 자리다.
 */

import { DASHBOARD_MAX_DAYS } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import {
  DASHBOARD_DEFAULT_DAYS,
  dayCount,
  defaultDashboardPeriod,
  growthOf,
  isSettled,
  kstDay,
  PENDING_HREFS,
  pendingItems,
  periodProblem,
  shiftDay,
  totalPending,
} from '@/lib/dashboard/dashboard-console'

import { dashboardPending } from './support/dashboard'

describe('KST 달력 날짜', () => {
  /**
   * UTC 로 자르면 서울의 하루가 아침 아홉 시에 시작한다. 자정을 갓 넘긴 서울에서
   * 대시보드를 열면 「오늘」이 어제가 되고, 그 화면은 매일 아침 매출이 사라졌다
   * 나타나는 것처럼 보인다.
   */
  it('rolls over at Seoul midnight, not UTC midnight', () => {
    expect(kstDay(new Date('2026-09-06T14:59:59.999Z'))).toBe('2026-09-06')
    expect(kstDay(new Date('2026-09-06T15:00:00.000Z'))).toBe('2026-09-07')
  })

  it('crosses month and year boundaries by asking Date, not by arithmetic on the string', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('기본 기간', () => {
  it('ends today and covers the last 30 days, both ends included', () => {
    const period = defaultDashboardPeriod(new Date('2026-09-06T03:00:00.000Z'))

    expect(period).toEqual({ from: '2026-08-08', to: '2026-09-06' })
    expect(dayCount(period)).toBe(DASHBOARD_DEFAULT_DAYS)
  })

  it('counts a single day as one, not zero', () => {
    expect(dayCount({ from: '2026-09-06', to: '2026-09-06' })).toBe(1)
  })
})

describe('물을 수 있는 기간인가', () => {
  it('accepts the period the screen opens with', () => {
    expect(periodProblem({ from: '2026-08-08', to: '2026-09-06' })).toBeNull()
  })

  /**
   * 서버는 거꾸로 고른 기간을 **하루짜리로 접어** 200 으로 답한다(`rangeOf`). 그대로
   * 보내면 운영자가 보는 것은 「거래액 0원」이고, 그것은 「날짜를 거꾸로 골랐다」와
   * 전혀 다른 문장이다.
   */
  it('names a reversed period rather than sending it', () => {
    expect(periodProblem({ from: '2026-09-06', to: '2026-08-08' })).toBe('reversed')
  })

  /**
   * **빈 칸을 먼저 본다.**
   *
   * 날짜 칸을 지우면 `''` 가 되고, 그것은 `to < from` 비교에서 조용히 통과한 뒤
   * `from=` 으로 나가 서버가 400 으로 답한다 — 그 400 은 어느 칸이 문제인지 말할 수
   * 없는 문장이라 사람이 고칠 데를 못 찾는다.
   */
  it('names an empty box rather than sending it', () => {
    expect(periodProblem({ from: '', to: '2026-09-06' })).toBe('incomplete')
    expect(periodProblem({ from: '2026-08-08', to: '' })).toBe('incomplete')
    // 빈 칸이 「거꾸로」보다 먼저다 — 둘 다 해당해도 사람이 할 일은 채우는 것이다.
    expect(periodProblem({ from: '', to: '' })).toBe('incomplete')
  })

  /** 계약의 상한과 **같은 값**으로 잰다. 서버가 원본이고 화면은 먼저 말할 뿐이다. */
  it('names a period past the contract ceiling', () => {
    const to = '2026-09-06'

    expect(periodProblem({ from: shiftDay(to, -(DASHBOARD_MAX_DAYS - 1)), to })).toBeNull()
    expect(periodProblem({ from: shiftDay(to, -DASHBOARD_MAX_DAYS), to })).toBe('tooLong')
  })
})

describe('증감', () => {
  it('reads a rise and a fall as the same shape with opposite directions', () => {
    expect(growthOf(900_000, 600_000)).toEqual({ direction: 'up', kind: 'ratio', percent: 50 })
    expect(growthOf(600_000, 900_000)).toEqual({
      direction: 'down',
      kind: 'ratio',
      percent: -33.3,
    })
  })

  it('says nothing changed when the two periods are equal', () => {
    expect(growthOf(600_000, 600_000)).toEqual({ direction: 'flat', kind: 'ratio', percent: 0 })
  })

  /**
   * 반올림이 0.0% 를 만들어도 **방향은 반올림 전의 차이**로 정한다. 「0.0% 늘었어요」는
   * 이상해 보이지만, 화살표까지 「변화 없음」으로 만들면 두 표시가 서로를 부정한다.
   */
  it('keeps the direction the raw difference had, even when the percent rounds to zero', () => {
    expect(growthOf(1_000_400, 1_000_000)).toEqual({
      direction: 'up',
      kind: 'ratio',
      percent: 0,
    })
  })

  /**
   * **0 에서 온 변화는 퍼센트가 아니다.** 0 으로 나눈 값을 그리면 `Infinity%` 가 뜨고,
   * 그것을 100% 로 반올림해 두면 「두 배로 늘었다」는 거짓말이 된다. 0 → 0 도 「0%」가
   * 아니다 — 그것은 변화 없음이 아니라 **아무 일도 없었음**이다.
   */
  it('refuses a percentage when the previous period was zero', () => {
    expect(growthOf(900_000, 0)).toEqual({ kind: 'none' })
    expect(growthOf(0, 0)).toEqual({ kind: 'none' })
  })
})

describe('처리 대기', () => {
  /**
   * 링크는 **콘솔의 지식**이다 — 계약은 건수만 보낸다. 경로가 사이드바의 것과
   * 갈라지면 대시보드에서 간 곳과 메뉴에서 간 곳이 달라지고, 그 어긋남은 눌러 보기
   * 전까지 조용하다.
   */
  it('carries the console route for each of the four queues', () => {
    expect(pendingItems(dashboardPending())).toEqual([
      { count: 3, href: '/sellers', key: 'sellerApplications' },
      { count: 2, href: '/claims', key: 'claims' },
      { count: 7, href: '/reports', key: 'reports' },
      { count: 0, href: '/settlements', key: 'settlements' },
    ])
  })

  /** 순서는 고정이다. 건수로 정렬하면 목록이 스스로 자리를 바꾼다. */
  it('keeps the contract order rather than sorting by count', () => {
    const keys = pendingItems(dashboardPending({ settlements: 99 })).map((item) => item.key)

    expect(keys).toEqual(Object.keys(PENDING_HREFS))
  })

  it('adds the four queues up', () => {
    expect(totalPending(dashboardPending())).toBe(12)
  })

  /** 넷이 전부 0 이면 표가 아니라 한 문장이다 — 이 화면에서 가장 좋은 소식이다. */
  it('tells "nothing to do" from "something to do"', () => {
    expect(isSettled(dashboardPending({ claims: 0, reports: 0, sellerApplications: 0 }))).toBe(true)
    expect(isSettled(dashboardPending())).toBe(false)
  })
})
