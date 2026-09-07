/**
 * KST 달력 날짜의 산술 (TASK-0082 · TASK-0092).
 *
 * ## 왜 따로 있는가
 *
 * 판매자 매출과 관리자 대시보드가 **같은 날짜 규칙**을 쓴다. 두 곳이 각자 계산하면
 * 어긋날 수 있고, 그 어긋남은 조용하다 — 같은 하루를 두 화면이 다르게 자르면 판매자가
 * 본 「어제 매출」과 관리자가 본 「어제 거래액」이 다르고, 어느 쪽도 오류를 내지 않는다.
 *
 * ## 왜 KST 인가
 *
 * 「어제 얼마 팔았나」의 하루는 **사람이 사는 곳의 하루**다. UTC 로 자르면 한국 시간
 * 아침 9시 이전의 주문이 전날로 들어가고, 그 표를 보는 사람은 매일 아침 매출이
 * 사라졌다 나타나는 것을 본다.
 *
 * I/O 도 상태도 없다. 문자열과 수만 오간다.
 */

const DAY_MS = 24 * 60 * 60 * 1_000

/** 서머타임이 없어 고정 오프셋으로 충분하다. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1_000

/** 이 순간의 KST 달력 날짜, `YYYY-MM-DD`. */
export function kstDate(instant: Date): string {
  return new Date(instant.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/** 1970-01-01 부터 센 일수. 문자열 날짜의 산술은 전부 여기를 지난다. */
export function dayIndexOf(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00.000Z`) / DAY_MS)
}

export function shiftDate(date: string, days: number): string {
  return new Date((dayIndexOf(date) + days) * DAY_MS).toISOString().slice(0, 10)
}

/** 두 날짜가 걸치는 날 수. 같은 날이면 1이다. */
export function daySpan(from: string, to: string): number {
  return dayIndexOf(to) - dayIndexOf(from) + 1
}

export interface DayRange {
  readonly from: string
  readonly to: string
  readonly dayCount: number
}

/**
 * 사람이 고른 기간을 **쓸 수 있는 기간**으로 접는다.
 *
 * 뒤집힌 기간은 하루짜리로 접고 던지지 않는다. 이것은 **읽기**이므로, 날짜 두 칸을
 * 잘못 고른 사람에게 빈 답을 주면 그만이다 — 500 을 내면 그 사람은 자기가 무엇을
 * 잘못했는지 알 수 없다.
 *
 * 너무 긴 기간은 **끝에서부터** 잘라 낸다. 상한이 없으면 한 요청이 몇 년치를 하루씩
 * 그리고, 최근을 남기는 것은 사람이 기간을 넓힐 때 보고 싶은 쪽이 최근이기 때문이다.
 */
export function rangeOf(
  params: { readonly from?: string; readonly to?: string },
  now: Date,
  options: { readonly defaultDays: number; readonly maxDays: number },
): DayRange {
  const to = params.to ?? kstDate(now)
  const from = params.from ?? shiftDate(to, -(options.defaultDays - 1))
  const span = daySpan(from, to)

  if (span < 1) return { from: to, to, dayCount: 1 }

  if (span > options.maxDays) {
    return { from: shiftDate(to, -(options.maxDays - 1)), to, dayCount: options.maxDays }
  }

  return { from, to, dayCount: span }
}

/**
 * 바로 **앞의 같은 길이** 기간.
 *
 * 「전월 대비」가 아닌 이유는 기간을 사람이 고르기 때문이다 — 7일을 보고 있는 사람에게
 * 지난달과의 비교를 내밀면 그 수는 화면의 어느 것과도 짝이 맞지 않는다.
 */
export function previousRange(range: DayRange): DayRange {
  const to = shiftDate(range.from, -1)

  return { from: shiftDate(to, -(range.dayCount - 1)), to, dayCount: range.dayCount }
}

/**
 * 없던 날을 0으로 채운다.
 *
 * 빈 날을 빼면 그래프가 그 구간을 건너뛰어 그리고, 「이 주에 3일 쉬었다」가 「매출이
 * 완만했다」로 보인다. 화면마다 다시 채우게 두지 않는 이유는 그 채우기가 조용히
 * 서로 다르게 되기 때문이다.
 */
export function fillDays<T extends { readonly date: string }>(
  rows: readonly T[],
  from: string,
  dayCount: number,
  empty: (date: string) => T,
): T[] {
  const byDate = new Map(rows.map((row) => [row.date, row]))

  return Array.from({ length: dayCount }, (_unused, offset) => {
    const date = shiftDate(from, offset)

    return byDate.get(date) ?? empty(date)
  })
}
