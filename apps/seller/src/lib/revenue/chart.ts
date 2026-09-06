import type { RevenueDay } from '@shopping/shared'

/**
 * 매출 추이 선 하나의 **좌표만** 만드는 곳 (TASK-0082 F5 · R2).
 *
 * ## 왜 차트 라이브러리를 넣지 않았나
 *
 * TASK-0082 R2 는 「가벼운 것으로」라고만 적어 두었고, 8장의 「확정된 버전」 표에
 * 채워진 이름이 없다. 그래서 이 저장소에 차트 의존성이 **하나도 없는 상태**에서
 * 그것을 고르는 일이 이 작업에 딸려 있었는데, 그리려는 것은 **선 하나**다.
 *
 * - Recharts·Chart.js·visx 는 전부 수십 KB 이고, 세 앱 중 하나만 쓰는 의존성이
 *   판매자 콘솔의 첫 화면 번들에 들어간다.
 * - 그 라이브러리들이 실제로 값을 하는 자리는 **축·툴팁·범례·상호작용**인데, F5 가
 *   요구하는 접근성 대체물은 툴팁이 아니라 **같은 숫자의 표**다. 즉 라이브러리가
 *   주는 것을 쓰지 않으면서 그 무게만 지불하게 된다.
 * - 게다가 대부분이 캔버스나 자기 DOM 을 그리므로, 「그림은 `aria-hidden`, 표가
 *   진짜 내용」이라는 F5 의 구조를 다시 조립해야 한다.
 *
 * 그래서 **좌표 계산만 순수 함수로 떼어 내고** 그리는 것은 인라인 SVG 에 맡긴다.
 * 라이브러리를 넣는 판단은 축·툴팁·여러 계열이 실제로 필요해지는 날로 미룬다.
 *
 * ## 여기 있는 것이 왜 순수 함수인가
 *
 * 좌표가 틀려도 **조용하다.** 화면은 멀쩡한 선을 하나 그리고, 판매자는 그 모양을
 * 보고 「지난주가 더 나았네」라고 읽는다. 어느 검사도 빨개지지 않는다. 그래서
 * `vitest.config.mjs` 가 이 파일을 분기 100% 로 잡는다.
 */

/**
 * 그림이 그려지는 좌표계. **픽셀이 아니다** — SVG 는 `viewBox` 로만 이 값을 읽고,
 * 실제 크기는 CSS 가 정한다.
 *
 * 가로세로가 정수인 이유는 눈금이 딱 떨어져야 해서가 아니라, 이 숫자가 화면 어디에도
 * 길이로 나타나지 않기 때문이다 — 토큰 규칙이 막는 것은 `'160px'` 같은 **CSS 길이**다.
 */
export const CHART_WIDTH = 600

export const CHART_HEIGHT = 160

/**
 * 위아래 여백.
 *
 * 0 이면 가장 높은 날의 점이 `y = 0` 에 서고, 선의 두께 절반이 `viewBox` 밖으로
 * 나가 **잘린 채** 그려진다. 가장 잘 판 날이 잘려 보이는 그림은 아무도 원하지 않는다.
 */
const PADDING_Y = 6

/** 좌표를 소수점 둘째 자리에서 끊는다. 그 아래는 어떤 화면에서도 보이지 않는다. */
const PRECISION = 100

function round(value: number): number {
  return Math.round(value * PRECISION) / PRECISION
}

export interface RevenueChartPoint {
  /** `YYYY-MM-DD`. 표와 그림이 **같은 날**을 가리키는지 검사가 이것으로 잰다. */
  readonly date: string
  readonly salesAmount: number
  readonly x: number
  readonly y: number
}

export interface RevenueChartGeometry {
  /** `<svg viewBox>` 에 그대로 들어간다. */
  readonly viewBox: string
  readonly points: readonly RevenueChartPoint[]
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
 * | 칸이 없다 | 계약이 `days` 에 최소 개수를 걸지 않는다 |
 * | 칸이 하나 | 시작과 끝을 같은 날로 고른다 |
 * | 전부 0원 | 한 건도 못 판 기간. 판매자에게 드물지 않다 |
 *
 * 뒤의 둘은 나눗셈의 분모가 0이 되는 자리이고, 그대로 두면 좌표가 `NaN` 이 되어
 * **선이 통째로 사라진다.** 그때 화면은 오류를 내지 않고 빈 그림을 그린다.
 */
export function revenueChartGeometry(days: readonly RevenueDay[]): RevenueChartGeometry {
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

  const points = days.map((day, index) => ({
    date: day.date,
    salesAmount: day.salesAmount,
    x: round(originX + step * index),
    // 한 건도 못 판 기간에서는 모든 날이 바닥에 눕는다. 0을 0으로 나누지 않는다.
    y: round(CHART_HEIGHT - PADDING_Y - (peak === 0 ? 0 : day.salesAmount / peak) * span),
  }))

  const pairs = points.map((point) => `${String(point.x)},${String(point.y)}`)
  const bottom = String(CHART_HEIGHT)
  // 양 끝의 x 를 `points[0]` 으로 읽지 않는다. 같은 식으로 다시 구하면 배열 색인이
  // 없어지고, 「비어 있을 리 없다」를 증명하려고 닿지 않는 갈래를 적을 일도 없다.
  const firstX = String(round(originX))
  const lastX = String(round(originX + step * (days.length - 1)))

  return {
    // 선을 그대로 따라간 뒤 바닥으로 내려와 닫는다. 면은 선을 **거들 뿐**이라
    // 옅게 칠하고, 값을 읽는 일은 아래 표가 맡는다.
    area: `M ${firstX},${bottom} L ${pairs.join(' L ')} L ${lastX},${bottom} Z`,
    line: pairs.join(' '),
    peak,
    points,
    viewBox,
  }
}
