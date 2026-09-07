import type { DashboardPendingResponse } from '@shopping/shared'
import { DASHBOARD_MAX_DAYS } from '@shopping/shared'

/**
 * 대시보드의 순수 판단 — **무엇을 묻고, 그 답을 어떻게 읽는가** (TASK-0092).
 *
 * `lib/settlements/settlement-console.ts` · `lib/reports/report-console.ts` 와 같은
 * 자리에 같은 이유로 있다: 여기 있는 것들은 전부 **틀려도 조용하다.** 기간을 하루
 * 어긋나게 계산하면 화면은 멀쩡한 그래프를 그리고, 증감률의 분모를 잘못 고르면
 * 그럴듯한 퍼센트가 하나 뜬다 — 그리고 운영자는 그 숫자를 보고 「이번 주는 괜찮다」고
 * 판단한다. 처리 대기의 링크가 틀리면 건수는 맞는데 눌러도 엉뚱한 화면이 열린다.
 *
 * I/O 도 렌더도 없다 (QUALITY-GATES 순수 로직 — `vitest.config.mjs` 가 이 파일을
 * 분기 100% 로 잡고 있다).
 */

const DAY_MS = 24 * 60 * 60 * 1_000

/**
 * KST 고정 오프셋 +09:00.
 *
 * `lib/claims/claim-console.ts` 의 `CONSOLE_UTC_OFFSET` 과 같은 상수를 같은 이유로
 * 쓴다 — 한국 표준시는 서머타임이 없어 고정 오프셋 산술이 IANA 표와 정확히 같은 답을
 * 낸다. 계약의 `date` 도 **KST 달력 날짜**이고(`dashboardDaySchema`), 서버가 하루를
 * 자르는 자리도 KST 자정이다(`kst-days.ts`).
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1_000

/** 처음 열었을 때 보이는 기간. 계약이 `from`·`to` 없이 불렸을 때 주는 것과 같은 길이다. */
export const DASHBOARD_DEFAULT_DAYS = 30

/** 화면이 들고 있는 기간. 둘 다 `YYYY-MM-DD` 이고 **양쪽 다 포함**이다. */
export interface DashboardPeriod {
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

/** 오늘까지의 최근 30일. 끝이 오늘인 이유는 운영자가 매일 묻는 것이 「오늘」이라서다. */
export function defaultDashboardPeriod(now: Date): DashboardPeriod {
  const to = kstDay(now)

  return { from: shiftDay(to, -(DASHBOARD_DEFAULT_DAYS - 1)), to }
}

/** 양 끝을 포함한 날 수. 거꾸로 고른 기간에서는 0 이하가 된다. */
export function dayCount(period: DashboardPeriod): number {
  return Math.round((Date.parse(period.to) - Date.parse(period.from)) / DAY_MS) + 1
}

/**
 * 이 기간을 그대로 물어도 되는가.
 *
 * **막지 않고 말한다** (`revenue-console.ts` 와 같은 규약). 고치는 방법이 그 입력뿐인데
 * 입력을 잠그면 되돌릴 길이 없고, 대신 오류가 그 칸에 붙어 어디를 고쳐야 하는지 말한다.
 *
 * 서버에 보내지 않는 것은 **답이 틀리기 때문이 아니다.** `rangeOf` 는 거꾸로 고른
 * 기간을 하루로, 너무 긴 기간을 끝에서부터 잘라 접어 200 으로 답한다 — 즉 화면은
 * 「거래액 0원」이나 **자기가 고른 적 없는 90일**을 그리게 되고, 둘 다 「날짜를
 * 거꾸로 골랐다」와 전혀 다른 문장이다.
 */
export type PeriodProblem = 'reversed' | 'tooLong'

export function periodProblem(period: DashboardPeriod): PeriodProblem | null {
  if (period.to < period.from) return 'reversed'
  // 계약의 상한을 화면이 먼저 잰다. 서버도 같은 값으로 접는다 — 그쪽이 원본이다.
  if (dayCount(period) > DASHBOARD_MAX_DAYS) return 'tooLong'

  return null
}

/**
 * 전 기간 대비 증감 (F3).
 *
 * **`none` 이 실패가 아니다.** 직전 기간이 0이면 증감률은 큰 수가 아니라 **없는
 * 수**다. 0으로 나눈 결과를 그리면 `Infinity%` 가 뜨고, 그것을 100% 로 반올림해 두면
 * 「두 배로 늘었다」는 거짓말이 된다. 0에서 0으로 간 것도 마찬가지로 「0%」가 아니다 —
 * 그것은 「변화 없음」이 아니라 **아무 일도 없었음**이다.
 *
 * 계약이 비율 대신 두 기간의 숫자만 보내는 이유가 그것이고
 * (`dashboardMetricsResponseSchema.previous`), 판매자 쪽에서 같은 판단을 이미 한
 * 것이 `apps/seller/src/lib/revenue/revenue-console.ts` 의 `growthOf` 다. 두 콘솔이
 * 서로를 import 할 수 없어(앱 사이에는 의존이 없다) 판단만 그대로 옮겼다 — 두 화면이
 * 같은 0을 다르게 그리면 그것이 이 함수가 막으려던 일이다.
 */
export type DashboardGrowth =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'ratio'
      /** 소수점 한 자리까지. 금액이 아니므로 정수 규칙이 걸리지 않는다. */
      readonly percent: number
      readonly direction: 'up' | 'down' | 'flat'
    }

/** 백분율의 해상도. 0.1% 아래는 이 화면에서 아무 뜻이 없다. */
const PERCENT_PRECISION = 10

export function growthOf(current: number, previous: number): DashboardGrowth {
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

/**
 * 처리 대기 네 줄 (F2).
 *
 * **링크는 여기서 붙는다.** 계약은 건수만 보낸다 — 어느 화면이 그 일을 처리하는지는
 * 콘솔의 라우트이고, 그것을 API 가 알면 화면을 옮길 때마다 서버를 고쳐야 한다
 * (`dashboardPendingResponseSchema` 의 머리말).
 *
 * 순서는 **계약의 순서 그대로** 고정이다. 건수로 정렬하면 목록이 30초마다 스스로
 * 자리를 바꾸고, 매일 같은 자리를 눈으로 찾는 사람에게 그것은 읽을 수 없는 화면이다.
 */
export const PENDING_KEYS = ['sellerApplications', 'claims', 'reports', 'settlements'] as const

export type PendingKey = (typeof PENDING_KEYS)[number]

/**
 * 각 줄이 여는 화면.
 *
 * 사이드바가 쓰는 경로와 **같은 문자열**이다(`layout.menu`). 다르면 대시보드에서 간
 * 곳과 메뉴에서 간 곳이 갈라지고, 그 어긋남은 눌러 보기 전까지 조용하다.
 */
export const PENDING_HREFS: Readonly<Record<PendingKey, string>> = {
  sellerApplications: '/sellers',
  claims: '/claims',
  reports: '/reports',
  settlements: '/settlements',
}

export interface PendingItem {
  readonly key: PendingKey
  readonly count: number
  readonly href: string
}

export function pendingItems(pending: DashboardPendingResponse): readonly PendingItem[] {
  return PENDING_KEYS.map((key) => ({ count: pending[key], href: PENDING_HREFS[key], key }))
}

/** 네 줄을 다 합쳐 몇 건인가. 이 화면이 답하는 한 문장이 이것이다. */
export function totalPending(pending: DashboardPendingResponse): number {
  return PENDING_KEYS.reduce((sum, key) => sum + pending[key], 0)
}

/**
 * 지금 할 일이 하나도 없는가.
 *
 * 0 이 넷 늘어선 표 대신 한 문장을 그리기 위한 판단이다. 이 화면에서 가장 좋은
 * 소식이고, 그것을 「0 · 0 · 0 · 0」으로 적으면 읽는 데 네 번 걸린다
 * (`claim-attention-panel.tsx` 가 같은 판단을 먼저 했다).
 */
export function isSettled(pending: DashboardPendingResponse): boolean {
  return totalPending(pending) === 0
}
