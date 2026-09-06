import { REVENUE_MAX_DAYS } from '@shopping/shared'

/**
 * 매출 대시보드의 순수 판단 — **무엇을 묻고, 그 답을 어떻게 비교하는가** (TASK-0082).
 *
 * `lib/settlements/settlement-console.ts` 와 같은 자리에 같은 이유로 있다: 여기 있는
 * 것들은 **틀려도 조용하다.** 기간을 하루 어긋나게 계산하면 화면은 멀쩡한 그래프를
 * 그리고, 증감률의 분모를 잘못 고르면 그럴듯한 퍼센트가 하나 뜬다 — 그리고 판매자는
 * 그 숫자를 보고 다음 달 발주를 정한다.
 *
 * I/O 도 렌더도 없다 (QUALITY-GATES 순수 로직 — `vitest.config.mjs` 가 이 파일을
 * 분기 100% 로 잡고 있다).
 */

const DAY_MS = 24 * 60 * 60 * 1_000

/**
 * KST 고정 오프셋 +09:00.
 *
 * `lib/claims/claim-console.ts` 의 `CONSOLE_UTC_OFFSET` 과 같은 상수를 같은 이유로
 * 쓴다 — 한국 표준시는 서머타임이 없어 고정 오프셋 산술이 IANA 표와 정확히 같은
 * 답을 낸다. 계약의 `date` 도 **KST 달력 날짜**다(`revenueDaySchema`).
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1_000

/** 처음 열었을 때 보이는 기간. 계약이 `from`·`to` 없이 부르면 주는 것과 같은 길이다. */
export const REVENUE_DEFAULT_DAYS = 30

/** 화면이 들고 있는 기간. 둘 다 `YYYY-MM-DD` 이고 **양쪽 다 포함**이다. */
export interface RevenuePeriod {
  readonly from: string
  readonly to: string
}

/** 그 순간의 **KST 달력 날짜**. 자정 직후 서울에서 「어제」가 되지 않게 한다. */
export function kstDay(instant: Date): string {
  return new Date(instant.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` 에서 며칠 뒤(음수면 앞). 달·연 경계는 `Date` 가 안다. */
export function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + delta * DAY_MS).toISOString().slice(0, 10)
}

/** 오늘까지의 최근 30일. 끝이 오늘인 이유는 판매자가 매일 묻는 것이 「오늘」이라서다. */
export function defaultRevenuePeriod(now: Date): RevenuePeriod {
  const to = kstDay(now)

  return { from: shiftDay(to, -(REVENUE_DEFAULT_DAYS - 1)), to }
}

/** 양 끝을 포함한 날 수. 거꾸로 고른 기간에서는 0 이하가 된다. */
export function dayCount(period: RevenuePeriod): number {
  return Math.round((Date.parse(period.to) - Date.parse(period.from)) / DAY_MS) + 1
}

/**
 * 이 기간을 그대로 물어도 되는가.
 *
 * **막지 않고 말한다** (`order-filters.tsx` 와 같은 규약). 고치는 방법이 그 입력뿐인데
 * 입력을 잠그면 되돌릴 길이 없고, 대신 오류가 그 칸에 붙어 어디를 고쳐야 하는지
 * 말한다. 서버에 보내지 않는 것은 **답이 틀리기 때문이 아니라** 판매자가 보게 될
 * 답이 「매출 0원」이라서다 — 그것은 「날짜를 거꾸로 골랐다」와 전혀 다른 문장이다.
 */
export type PeriodProblem = 'reversed' | 'tooLong'

export function periodProblem(period: RevenuePeriod): PeriodProblem | null {
  if (period.to < period.from) return 'reversed'
  // 계약의 상한을 화면이 먼저 재는 이유는 400 을 받아 「알 수 없는 오류」로 옮기지
  // 않기 위해서다. 서버도 같은 값으로 막는다 — 그쪽이 원본이다.
  if (dayCount(period) > REVENUE_MAX_DAYS) return 'tooLong'

  return null
}

/**
 * 전 기간 대비 증감 (F6).
 *
 * **`none` 이 실패가 아니다.** 지난 기간 매출이 0원이면 증감률은 큰 수가 아니라
 * **없는 수**다. 0으로 나눈 결과를 그리면 `Infinity%` 가 뜨고, 그것을 100% 로
 * 반올림해 두면 「두 배로 늘었다」는 거짓말이 된다 — 계약이 비율 대신 숫자만
 * 보내는 이유가 그것이고(`sellerRevenueResponseSchema.previous`), 그 판단을
 * 화면마다 다시 하지 않도록 여기서 한 번 한다.
 */
export type RevenueGrowth =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'ratio'
      /** 소수점 한 자리까지. 금액이 아니므로 정수 규칙이 걸리지 않는다. */
      readonly percent: number
      readonly direction: 'up' | 'down' | 'flat'
    }

/** 백분율의 해상도. 0.1% 아래는 이 화면에서 아무 뜻이 없다. */
const PERCENT_PRECISION = 10

export function growthOf(current: number, previous: number): RevenueGrowth {
  if (previous === 0) return { kind: 'none' }

  const ratio = ((current - previous) / previous) * 100
  // 방향은 **반올림 전의 차이**로 정한다. 0.04% 늘어난 것을 「0.0%」로 적더라도
  // 화살표까지 「변화 없음」으로 만들면 두 표시가 서로를 부정한다.
  const direction = current > previous ? 'up' : current < previous ? 'down' : 'flat'

  return {
    direction,
    kind: 'ratio',
    percent: Math.round(ratio * PERCENT_PRECISION) / PERCENT_PRECISION,
  }
}
