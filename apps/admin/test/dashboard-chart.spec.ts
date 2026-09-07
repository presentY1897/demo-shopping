/**
 * 거래액 추이 선의 좌표 (TASK-0092 F1).
 *
 * 좌표가 틀려도 **조용하다.** 화면은 멀쩡한 선을 하나 그리고, 운영자는 그 모양을 보고
 * 「지난주가 더 나았네」라고 읽는다. 특히 분모가 0이 되는 두 자리는 좌표를 `NaN` 으로
 * 만들어 **선을 통째로 지우는데**, 그때도 오류는 나지 않는다.
 */

import { describe, expect, it } from 'vitest'

import { CHART_HEIGHT, CHART_WIDTH, salesChartGeometry } from '@/lib/dashboard/chart'

import { METRIC_DAYS } from './support/dashboard'

/** `x,y` 쌍들을 숫자로. `NaN` 이 섞이면 여기서 드러난다. */
function coordinates(line: string): readonly number[] {
  return line.split(/[ ,]/).map(Number)
}

describe('the sales trend geometry', () => {
  it('spans the full viewBox and puts the best day at the top', () => {
    const geometry = salesChartGeometry(METRIC_DAYS)

    expect(geometry.viewBox).toBe(`0 0 ${String(CHART_WIDTH)} ${String(CHART_HEIGHT)}`)
    expect(geometry.peak).toBe(480_000)
    expect(geometry.points.map((point) => point.x)).toEqual([0, 300, 600])
    // 가장 잘 판 날이 가장 위다. 여백만큼 내려와 있어 선의 두께가 잘리지 않는다.
    expect(geometry.points[1]?.y).toBe(6)
  })

  /** 표와 그림이 **같은 날**을 가리키는지는 여기서만 잴 수 있다 — 그림은 읽히지 않는다. */
  it('keeps each point tied to the day it came from', () => {
    expect(salesChartGeometry(METRIC_DAYS).points.map((point) => point.date)).toEqual(
      METRIC_DAYS.map((day) => day.date),
    )
  })

  /**
   * 계약이 `days` 에 최소 개수를 걸지 않는다. 빈 배열에서 `points[0]` 을 읽는 코드는
   * 여기서 터지는 대신 `undefined` 를 문자열로 그린다.
   */
  it('draws nothing at all for an empty period', () => {
    const geometry = salesChartGeometry([])

    expect(geometry).toMatchObject({ area: '', line: '', peak: 0, points: [] })
  })

  /**
   * 시작과 끝을 같은 날로 고르면 칸이 하나다. 나눌 간격이 없어 분모가 0이 되는
   * 자리이고, 왼쪽 끝에 붙이면 「기간의 시작」이 아니라 「잘린 그래프」로 보인다.
   */
  it('stands a single day in the middle instead of dividing by zero', () => {
    const geometry = salesChartGeometry([
      { date: '2026-09-06', orderCount: 1, salesAmount: 10_000 },
    ])

    expect(geometry.points).toEqual([
      { date: '2026-09-06', salesAmount: 10_000, x: CHART_WIDTH / 2, y: 6 },
    ])
    expect(coordinates(geometry.line).some(Number.isNaN)).toBe(false)
  })

  /**
   * 한 건도 안 팔린 기간. 최고액이 0이라 `salesAmount / peak` 이 0/0 이 되고, 그대로
   * 두면 모든 좌표가 `NaN` 이 되어 선이 사라진다 — 화면은 오류 없이 빈 그림을 그린다.
   */
  it('lays a flat line on the floor when nothing sold, rather than losing the line', () => {
    const geometry = salesChartGeometry([
      { date: '2026-09-05', orderCount: 0, salesAmount: 0 },
      { date: '2026-09-06', orderCount: 0, salesAmount: 0 },
    ])

    expect(geometry.peak).toBe(0)
    expect(geometry.points.map((point) => point.y)).toEqual([CHART_HEIGHT - 6, CHART_HEIGHT - 6])
    expect(coordinates(geometry.line).some(Number.isNaN)).toBe(false)
  })

  /** 면은 선을 따라간 뒤 바닥으로 내려와 닫힌다. 열린 `path` 는 조용히 이상하게 칠해진다. */
  it('closes the filled area on the floor at both ends', () => {
    const geometry = salesChartGeometry(METRIC_DAYS)

    expect(geometry.area.startsWith(`M 0,${String(CHART_HEIGHT)} L `)).toBe(true)
    expect(geometry.area.endsWith(`L 600,${String(CHART_HEIGHT)} Z`)).toBe(true)
  })
})
