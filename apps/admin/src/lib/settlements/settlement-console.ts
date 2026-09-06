import type { Settlement, SettlementListQueryParams, SettlementStatus } from '@shopping/shared'

/**
 * 정산 화면의 순수 판단 — **무엇을 묻고, 그 답을 어떤 다섯 줄로 읽는가.**
 *
 * `lib/claims/claim-console.ts` 와 같은 자리에 같은 이유로 있다: 여기 있는 것들은
 * **틀려도 조용하다.** 회차를 한 주 어긋나게 계산하면 화면은 「이 조건에 정산서가
 * 없습니다」를 멀쩡히 그리고, 계산 근거의 부호를 뒤집으면 합이 맞지 않는 표가
 * 그려질 뿐 어느 검사도 빨개지지 않는다.
 *
 * I/O 도 렌더도 없다 (QUALITY-GATES 순수 로직 — `vitest.config.mjs` 가 이 파일을
 * 분기 100% 로 잡고 있다).
 */

/* --------------------------------------------------------------- 회차 -- */

/** 하루. */
const DAY_MS = 24 * 60 * 60 * 1_000

/**
 * KST 고정 오프셋 +09:00.
 *
 * `lib/claims/claim-console.ts` 의 `CONSOLE_UTC_OFFSET` 과 같은 상수를 같은 이유로
 * 쓴다 — 한국 표준시는 서머타임이 없어 고정 오프셋 산술이 IANA 표와 정확히 같은
 * 답을 낸다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1_000

const DAYS_IN_WEEK = 7

/** 1970-01-01 은 목요일. 그날부터 센 일수를 요일로 옮길 때 쓴다. */
const EPOCH_DAY_OF_WEEK = 4

/**
 * 이 날이 속한 **회차의 시작 순간** (월요일 00:00 KST).
 *
 * ## 왜 고른 날짜를 그대로 보내지 않는가
 *
 * 계약의 `periodStart` 는 구간이 아니라 **한 순간**이고, 서버는 그것을
 * `where.periodStart = new Date(params.periodStart)` 로 **정확히 일치**시킨다
 * (`settlement-console.service.ts`). 회차는 언제나 월요일 자정에 시작하므로,
 * 사람이 고른 수요일을 그대로 실어 보내면 **아무 정산서도 걸리지 않는다** — 그리고
 * 그 화면은 「이 회차에는 정산서가 없습니다」라고 말한다. 없는 것은 회차가 아니라
 * 그 순간이었는데도.
 *
 * 그래서 화면이 날짜를 회차로 **접는다.** 이 계산은
 * `apps/api/src/settlement/settlement-calc.ts` 의 `weekBefore` 가 회차의 경계를
 * 정하는 방식과 같은 것이고(그쪽이 원본이다), 어긋났을 때의 최악은 **빈 목록**이지
 * 틀린 쓰기가 아니다.
 */
export function periodStartOf(day: string): string {
  const chosen = new Date(`${day}T00:00:00.000+09:00`).getTime()
  const dayIndex = Math.floor((chosen + KST_OFFSET_MS) / DAY_MS)
  const dayOfWeek = (dayIndex + EPOCH_DAY_OF_WEEK) % DAYS_IN_WEEK
  // 월요일이 0 이 되게 옮긴다. 일요일(0)은 6이다 — 그 주의 마지막 날이다.
  const sinceMonday = (dayOfWeek + DAYS_IN_WEEK - 1) % DAYS_IN_WEEK

  return new Date((dayIndex - sinceMonday) * DAY_MS - KST_OFFSET_MS).toISOString()
}

/** 회차의 길이 — 한 주. 경계는 언제나 월요일 자정 KST 다. */
const PERIOD_MS = DAYS_IN_WEEK * DAY_MS

/**
 * 회차의 **열린 끝** — 다음 회차의 시작과 같은 순간.
 *
 * 필터가 고른 날에서 회차를 그려 보일 때 쓴다. 목록의 줄은 서버가 보낸
 * `periodEnd` 를 그대로 쓰므로 이 계산을 지나지 않는다 — 화면이 계산한 끝과 서버가
 * 보낸 끝이 다르면 옳은 것은 언제나 서버 쪽이다.
 */
export function periodEndOf(periodStart: string): string {
  return new Date(new Date(periodStart).getTime() + PERIOD_MS).toISOString()
}

/**
 * 회차의 **마지막 순간** — 화면에 그릴 「~ 8월 30일」의 그 날.
 *
 * 계약의 `periodEnd` 는 **포함하지 않는 끝**이고 다음 회차의 시작과 정확히
 * 맞물린다(`settlementSchema`). 그것을 그대로 그리면 8월 24일에 시작한 회차가
 * 「8월 24일 ~ 8월 31일」로 보이고, 다음 회차도 8월 31일에 시작한다 — 하루가 두
 * 회차에 걸쳐 있는 것처럼 읽힌다. 1밀리초를 빼는 것이 그 하루를 되돌린다.
 */
export function inclusiveEnd(periodEnd: string): string {
  return new Date(new Date(periodEnd).getTime() - 1).toISOString()
}

/* ------------------------------------------------------------- 필터 -- */

/**
 * 목록 필터가 들고 있는 것.
 *
 * `sellerName` 만 질의로 나가지 않는다 — 계약이 아는 것은 `sellerId` 뿐이고, 화면은
 * 「루미에르만 보는 중」이라고 말해야 하기 때문이다. 골라 온 자리(목록의 행)가 그
 * 이름을 함께 알고 있으므로 지어낸 값이 아니다 (`lib/claims/claim-console.ts` 의
 * 같은 규약).
 */
export interface SettlementFilters {
  /** `YYYY-MM-DD`. 그 날이 **속한 회차**를 뜻한다 — {@link periodStartOf} 가 접는다. */
  readonly day: string | null
  readonly sellerId: string | null
  readonly sellerName: string | null
  readonly status: SettlementStatus | null
}

export const EMPTY_SETTLEMENT_FILTERS: SettlementFilters = {
  day: null,
  sellerId: null,
  sellerName: null,
  status: null,
}

/** 하나라도 좁혔는가. 빈 목록이 「없다」인지 「이 조건에 없다」인지를 가른다. */
export function isNarrowed(filters: SettlementFilters): boolean {
  return filters.day !== null || filters.sellerId !== null || filters.status !== null
}

/**
 * 필터를 계약의 질의로. 커서와 개수는 부르는 쪽이 얹는다.
 *
 * 값이 없는 축은 **키 자체를 넣지 않는다.** `undefined` 를 실어 보내면
 * `URLSearchParams` 가 `status=undefined` 를 만들고, 서버는 그것을 잘못된 상태로
 * 읽어 400 으로 답한다.
 */
export function queryOf(filters: SettlementFilters): SettlementListQueryParams {
  return {
    ...(filters.day === null ? {} : { periodStart: periodStartOf(filters.day) }),
    ...(filters.sellerId === null ? {} : { sellerId: filters.sellerId }),
    // 계약의 `status` 는 목록이지만 화면이 고르는 것은 한 값이다. 문법은 쉼표 하나다.
    ...(filters.status === null ? {} : { status: [filters.status] }),
  }
}

/* --------------------------------------------------------- 계산 근거 -- */

/**
 * 계산 근거 한 줄이 무엇인가 (F1).
 *
 * 이름이 곧 카탈로그의 열쇠다 — `Record<CalculationLineKey, string>` 이라 줄이 하나
 * 늘면 문구가 없는 것을 typecheck 이 잡는다.
 */
export const calculationLineKeys = [
  'sales',
  'commission',
  'sellerCoupon',
  'returnAdjustment',
  'payout',
] as const

export type CalculationLineKey = (typeof calculationLineKeys)[number]

export interface CalculationLine {
  readonly key: CalculationLineKey
  /** 화면에 그대로 그리는 금액. **차감 줄은 음수다.** */
  readonly amount: number
  /** 마지막 줄 — 위의 넷을 더한 결과. 굵게 서고 구분선 아래에 온다. */
  readonly total: boolean
}

/**
 * TASK-0081 4장이 그린 다섯 줄, 그대로.
 *
 * ```
 * 판매액          1,890,000
 * − 수수료         -189,000
 * − 판매자 쿠폰     -30,000
 * − 반품 차감      -120,000
 * ────────────────────────
 * 지급액          1,551,000
 * ```
 *
 * ## 부호를 여기서 정한다
 *
 * 계약이 싣는 `commissionAmount` 와 `sellerCouponAmount` 는 **양수**이고
 * (`wonSchema`), `returnAdjustmentAmount` 는 이미 **음수이거나 0**이다
 * (`z.int().max(0)`). 화면이 셋을 같은 열에 세우려면 앞의 둘을 뒤집어야 하는데, 그
 * 뒤집기를 표를 그리는 자리마다 하면 언젠가 한 곳이 빠지고 **합이 맞지 않는 표**가
 * 그려진다. 판매자가 이의를 제기했을 때 관리자가 보는 것이 이 표다.
 *
 * ## 합을 다시 계산하지 않는다
 *
 * 마지막 줄은 `payoutAmount` **그대로**다. 네 줄을 더해 그리면 화면이 서버와 다른
 * 답을 낼 수 있게 되고, 그때 옳은 것은 언제나 서버 쪽이다 — DB 의 검사 제약이 그
 * 식을 강제한다. 화면이 할 일은 「왜 이 금액인가」를 보여 주는 것이지 그 금액을
 * 정하는 것이 아니다.
 */
export function calculationLines(settlement: Settlement): readonly CalculationLine[] {
  return [
    { key: 'sales', amount: settlement.salesAmount, total: false },
    { key: 'commission', amount: -settlement.commissionAmount, total: false },
    { key: 'sellerCoupon', amount: -settlement.sellerCouponAmount, total: false },
    { key: 'returnAdjustment', amount: settlement.returnAdjustmentAmount, total: false },
    { key: 'payout', amount: settlement.payoutAmount, total: true },
  ]
}

/**
 * 이 정산서를 여는 주소. 목록의 줄과 일괄 승인의 실패 목록이 같은 곳을 가리킨다.
 */
export function settlementHref(id: string): string {
  return `/settlements/${id}`
}

/**
 * 정산서의 한 줄에서 **그 주문으로** (F2).
 *
 * 관리자 주문 화면은 아직 껍데기이고(TASK-0095, `app/orders/page.tsx`) 그 화면의
 * 질의 계약은 아직 없다. 그래서 이 링크는 **`pages.md` 가 이미 「전체 주문 조회」에
 * 배정해 둔 경로**로 가고, 정산서가 들고 있는 두 값을 그대로 얹는다 — 사람이
 * 알아보는 주문번호와, 화면이 조회에 쓸 수 있는 몫의 id 다. 주문 화면이 도착하면
 * 둘 중 무엇을 읽든 이 링크는 그대로 맞는다.
 *
 * 링크를 아예 걸지 않는 선택지도 있었지만, 그러면 F2 가 재려는 것 — 「이의를
 * 제기받았을 때 근거로 곧장 내려갈 수 있는가」 — 이 화면에서 사라진다.
 */
export function orderHref(orderNumber: string, sellerOrderId: string): string {
  const params = new URLSearchParams({ orderNumber, sellerOrderId })

  return `/orders?${params.toString()}`
}
