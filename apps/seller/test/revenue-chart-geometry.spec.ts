/**
 * 매출 추이 선의 좌표 (TASK-0082 F5 · R2).
 *
 * **틀려도 조용한 계산이라 여기서 잰다.** 화면은 어떤 좌표를 받아도 멀쩡한 선을 하나
 * 그리고, 판매자는 그 모양을 보고 지난주와 비교한다. `vitest.config.mjs` 가 이
 * 모듈을 분기 100% 로 잡는 이유이고, 아래 세 절이 그 분기 셋이다 — 칸이 없을 때,
 * 칸이 하나일 때, 그리고 **한 건도 못 판 기간**일 때.
 */

import type { RevenueDay } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { CHART_HEIGHT, CHART_WIDTH, revenueChartGeometry } from '@/lib/revenue/chart'

function day(date: string, salesAmount: number, orderCount = 1): RevenueDay {
  return { date, orderCount, salesAmount }
}

const THREE_DAYS: readonly RevenueDay[] = [
  day('2026-09-01', 0, 0),
  day('2026-09-02', 50_000),
  day('2026-09-03', 100_000),
]

describe('revenueChartGeometry', () => {
  it('places one point per day, left to right', () => {
    const { points } = revenueChartGeometry(THREE_DAYS)

    expect(points.map((point) => point.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
    expect(points.map((point) => point.x)).toEqual([0, CHART_WIDTH / 2, CHART_WIDTH])
  })

  it('puts the best day highest and the worst on the floor', () => {
    const [first, , last] = revenueChartGeometry(THREE_DAYS).points

    // y 는 아래로 자란다 — 가장 많이 판 날이 가장 작은 y 다.
    expect(last?.y).toBeLessThan(first?.y ?? 0)
    // 여백이 없으면 선의 두께 절반이 잘린다. 꼭대기가 0이 아닌 것이 그 증거다.
    expect(last?.y).toBeGreaterThan(0)
    expect(first?.y).toBeLessThan(CHART_HEIGHT)
  })

  it('reports the best day so the axis can be labelled', () => {
    expect(revenueChartGeometry(THREE_DAYS).peak).toBe(100_000)
  })

  it('closes the area path down to the baseline', () => {
    const { area } = revenueChartGeometry(THREE_DAYS)

    expect(area.startsWith(`M 0,${String(CHART_HEIGHT)}`)).toBe(true)
    expect(area.endsWith(`L ${String(CHART_WIDTH)},${String(CHART_HEIGHT)} Z`)).toBe(true)
  })

  it('writes the line as a polyline point list', () => {
    expect(revenueChartGeometry(THREE_DAYS).line.split(' ')).toHaveLength(3)
  })

  describe('with no days at all', () => {
    // 계약이 `days` 에 최소 개수를 걸지 않는다. 빈 배열에서 선을 그리려 들면
    // `points[0]` 이 `undefined` 가 되고, 그 좌표는 `NaN` 으로 렌더된다.
    it('draws nothing rather than a broken path', () => {
      const geometry = revenueChartGeometry([])

      expect(geometry.points).toEqual([])
      expect(geometry.line).toBe('')
      expect(geometry.area).toBe('')
      expect(geometry.peak).toBe(0)
    })

    it('still reports a viewBox, so the SVG keeps its shape', () => {
      expect(revenueChartGeometry([]).viewBox).toBe(
        `0 0 ${String(CHART_WIDTH)} ${String(CHART_HEIGHT)}`,
      )
    })
  })

  describe('with a single day', () => {
    // 시작과 끝을 같은 날로 고르면 이렇게 된다. 간격이 없으므로 `width / (n - 1)`
    // 이 0으로 나누기가 되고, 손대지 않으면 x 가 `Infinity` 다.
    it('centres the point instead of dividing by zero', () => {
      const { points } = revenueChartGeometry([day('2026-09-03', 100_000)])

      expect(points).toHaveLength(1)
      expect(points[0]?.x).toBe(CHART_WIDTH / 2)
      expect(Number.isFinite(points[0]?.y)).toBe(true)
    })
  })

  describe('with nothing sold all period', () => {
    // 판매자에게 드물지 않은 기간이다. 꼭대기가 0이면 `amount / peak` 이 0/0 이고,
    // 그 결과는 `NaN` — 선이 통째로 사라진다.
    it('lays every day on the floor', () => {
      const { points, peak } = revenueChartGeometry([
        day('2026-09-01', 0, 0),
        day('2026-09-02', 0, 0),
      ])

      expect(peak).toBe(0)
      expect(points.map((point) => point.y)).toEqual([points[0]?.y, points[0]?.y])
      expect(points.every((point) => Number.isFinite(point.y))).toBe(true)
    })
  })
})
