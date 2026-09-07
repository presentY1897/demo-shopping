import type { DashboardDay } from '@shopping/shared'

/**
 * 거래액 추이 선 하나의 **좌표만** 만드는 곳 (TASK-0092 F1).
 *
 * ## 왜 차트 라이브러리를 넣지 않았나
 *
 * `apps/seller/src/lib/revenue/chart.ts` 가 판매자 매출 추이에서 같은 판단을 먼저
 * 했고, 그 머리말에 이유가 전부 적혀 있다 — 그리려는 것은 **선 하나**이고, 라이브러리가
 * 값을 하는 자리(축·툴팁·범례·상호작용)를 이 화면은 쓰지 않으면서 무게만 지불하게
 * 된다. 게다가 대부분이 캔버스나 자기 DOM 을 그리므로 「그림은 `aria-hidden`, 표가 진짜
 * 내용」이라는 구조를 다시 조립해야 한다.
 *
 * ## 왜 그 파일을 import 하지 않고 다시 적었나
 *
 * **앱 사이에는 의존이 없다.** `apps/admin` 의 `package.json` 은 `apps/seller` 를 모르고,
 * 그것이 세 앱이 따로 배포되는 이유이기도 하다. 공용으로 올리려면 `packages/ui` 여야
 * 하는데 그 패키지는 이 TASK 의 소유 경로가 아니다(그리고 컴포넌트를 하나 늘리면
 * 스토리와 axe 게이트가 따라온다 — CLAUDE.md 6장). 그래서 **판단을 옮겨 적고 출처를
 * 적어 둔다.** 언젠가 세 번째 화면이 같은 선을 그리면 그때가 올릴 때다.
 *
 * ## 여기 있는 것이 왜 순수 함수인가
 *
 * 좌표가 틀려도 **조용하다.** 화면은 멀쩡한 선을 하나 그리고, 운영자는 그 모양을 보고
 * 「지난주가 더 나았네」라고 읽는다. 어느 검사도 빨개지지 않는다. 그래서
 * `vitest.config.mjs` 가 이 파일을 분기 100% 로 잡는다.
 */

/**
 * 그림이 그려지는 좌표계. **픽셀이 아니다** — SVG 는 `viewBox` 로만 이 값을 읽고,
 * 실제 크기는 CSS 가 정한다. 그래서 이 숫자들은 화면 어디에도 길이로 나타나지 않고,
 * 토큰 규칙(`packages/ui/test/component-tokens.spec.ts`)이 막는 CSS 길이가 아니다.
 */
export const CHART_WIDTH = 600

export const CHART_HEIGHT = 160

/**
 * 위아래 여백.
 *
 * 0 이면 가장 높은 날의 점이 `y = 0` 에 서고, 선의 두께 절반이 `viewBox` 밖으로 나가
 * **잘린 채** 그려진다. 가장 잘 판 날이 잘려 보이는 그림은 아무도 원하지 않는다.
 */
const PADDING_Y = 6

/** 좌표를 소수점 둘째 자리에서 끊는다. 그 아래는 어떤 화면에서도 보이지 않는다. */
const PRECISION = 100

function round(value: number): number {
  return Math.round(value * PRECISION) / PRECISION
}

export interface SalesChartPoint {
  /** `YYYY-MM-DD`. 표와 그림이 **같은 날**을 가리키는지 검사가 이것으로 잰다. */
  readonly date: string
  readonly salesAmount: number
  readonly x: number
  readonly y: number
}

export interface SalesChartGeometry {
  /** `<svg viewBox>` 에 그대로 들어간다. */
  readonly viewBox: string
  readonly points: readonly SalesChartPoint[]
  /** `<polyline points>`. 점이 없으면 빈 문자열이다. */
  readonly line: string
  /** `<path d>` — 선 아래를 바닥까지 닫은 면. 점이 없으면 빈 문자열이다. */
  readonly area: string
  /** 이 기간에서 가장 많이 판 날의 금액. y축 꼭대기에 적는다. */
  readonly peak: number
}

/**
 * 하루치 칸들을 선 하나로.
 *
 * 세 가지 경계를 **전부 실제로 만난다** — 방어적으로 적어 둔 갈래가 아니다.
 *
 * | 경계 | 언제 |
 * | --- | --- |
 * | 칸이 없다 | 계약이 `days` 에 최소 개수를 걸지 않는다 (`dashboardMetricsResponseSchema`) |
 * | 칸이 하나 | 시작과 끝을 같은 날로 고른다 — 서버는 그것을 하루짜리 기간으로 답한다 |
 * | 전부 0원 | 한 건도 안 팔린 기간. 개발 환경과 배포 직후에 흔하다 |
 *
 * 뒤의 둘은 나눗셈의 분모가 0이 되는 자리이고, 그대로 두면 좌표가 `NaN` 이 되어 **선이
 * 통째로 사라진다.** 그때 화면은 오류를 내지 않고 빈 그림을 그린다.
 */
export function salesChartGeometry(days: readonly DashboardDay[]): SalesChartGeometry {
  const viewBox = `0 0 ${String(CHART_WIDTH)} ${String(CHART_HEIGHT)}`
  const peak = days.reduce((highest, day) => Math.max(highest, day.salesAmount), 0)

  if (days.length === 0) {
    return { area: '', line: '', peak, points: [], viewBox }
  }

  const span = CHART_HEIGHT - PADDING_Y * 2
  // 칸이 하나뿐이면 나눌 간격이 없다. 가운데에 점 하나를 세운다 — 왼쪽 끝에 붙이면
  // 「기간의 시작」이 아니라 「잘린 그래프」로 보인다.
  const step = days.length === 1 ? 0 : CHART_WIDTH / (days.length - 1)
  const originX = days.length === 1 ? CHART_WIDTH / 2 : 0

  const points = days.map((day, index): SalesChartPoint => ({
    date: day.date,
    salesAmount: day.salesAmount,
    x: round(originX + step * index),
    // 한 건도 안 팔린 기간에서는 모든 날이 바닥에 눕는다. 0을 0으로 나누지 않는다.
    y: round(CHART_HEIGHT - PADDING_Y - (peak === 0 ? 0 : day.salesAmount / peak) * span),
  }))

  const pairs = points.map((point) => `${String(point.x)},${String(point.y)}`)
  const bottom = String(CHART_HEIGHT)
  // 양 끝의 x 를 `points[0]` 으로 읽지 않는다. 같은 식으로 다시 구하면 배열 색인이
  // 없어지고, 「비어 있을 리 없다」를 증명하려고 닿지 않는 갈래를 적을 일도 없다.
  const firstX = String(round(originX))
  const lastX = String(round(originX + step * (days.length - 1)))

  return {
    // 선을 그대로 따라간 뒤 바닥으로 내려와 닫는다. 면은 선을 **거들 뿐**이라 옅게
    // 칠하고, 값을 읽는 일은 아래 표가 맡는다.
    area: `M ${firstX},${bottom} L ${pairs.join(' L ')} L ${lastX},${bottom} Z`,
    line: pairs.join(' '),
    peak,
    points,
    viewBox,
  }
}
