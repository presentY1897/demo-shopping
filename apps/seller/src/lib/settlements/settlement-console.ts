import type { Settlement, SettlementListQueryParams, SettlementStatus } from '@shopping/shared'

/**
 * 정산 화면의 순수 판단 — **무엇을 묻고, 그 답을 어떤 다섯 줄로 읽는가** (TASK-0082).
 *
 * `lib/coupons/coupon-console.ts` 와 같은 자리에 같은 이유로 있다: 여기 있는 것들은
 * **틀려도 조용하다.** 계산 근거의 부호를 뒤집으면 합이 맞지 않는 표가 그려질 뿐
 * 어느 검사도 빨개지지 않고, 판매자는 그 표를 보고 「왜 이 금액이냐」를 묻는다 —
 * 그 물음을 없애는 것이 TASK-0082 4장이 하려는 일이다.
 *
 * ## 관리자 콘솔과 **같은 다섯 줄**이다
 *
 * `apps/admin/src/lib/settlements/settlement-console.ts` 에 같은 이름의 함수가 있고,
 * 둘은 같은 표를 그린다. 복사가 아니라 **거울**이다 — 두 콘솔은 서로를 import 할 수
 * 없고(각자 자기 `@/` 만 본다), 공유 패키지에 올릴 만큼 계약도 아니다. 어긋나면
 * 판매자와 관리자가 같은 정산서를 다른 숫자로 읽게 되므로(F3), 한쪽을 고치면 반드시
 * 다른 쪽도 고친다. 그것을 잊어도 **금액 자체는 어긋나지 않는다** — 마지막 줄이
 * 서버의 `payoutAmount` 그대로이기 때문이다(아래).
 *
 * I/O 도 렌더도 없다 (QUALITY-GATES 순수 로직 — `vitest.config.mjs` 가 이 파일을
 * 분기 100% 로 잡고 있다).
 */

/* --------------------------------------------------------------- 회차 -- */

/**
 * 회차의 **마지막 순간** — 화면에 그릴 「~ 8월 30일」의 그 날.
 *
 * 계약의 `periodEnd` 는 **포함하지 않는 끝**이고 다음 회차의 시작과 정확히
 * 맞물린다(`settlementSchema`). 그것을 그대로 그리면 8월 24일에 시작한 회차가
 * 「8월 24일 ~ 8월 31일」로 보이고, 다음 회차도 8월 31일에 시작한다 — 하루가 두
 * 회차에 걸쳐 있는 것처럼 읽힌다. 1밀리초를 빼는 것이 그 하루를 되돌린다.
 */
export function inclusiveEnd(periodEnd: string): string {
  return new Date(Date.parse(periodEnd) - 1).toISOString()
}

/* --------------------------------------------------------------- 필터 -- */

/**
 * 목록 필터가 들고 있는 것. **`sellerId` 가 없다.**
 *
 * 판매자는 자기 것만 보므로 고를 축이 상태 하나뿐이다. 자기 id 는 필터가 아니라
 * 이 목록이 존재하기 위한 조건이고, 그것을 필터로 두면 「전체」를 고를 수 있는
 * 것처럼 보인다 — 그 요청은 403 으로 끝난다(아래 {@link sellerSettlementQuery}).
 */
export interface SellerSettlementFilters {
  readonly status: SettlementStatus | null
}

export const EMPTY_SETTLEMENT_FILTERS: SellerSettlementFilters = { status: null }

/** 좁혀 놓았는가. 빈 목록이 「없다」인지 「이 조건에 없다」인지를 가른다. */
export function isNarrowed(filters: SellerSettlementFilters): boolean {
  return filters.status !== null
}

/**
 * 필터를 계약의 질의로. 커서와 개수는 부르는 쪽이 얹는다.
 *
 * **`sellerId` 를 반드시 싣는다.** 매출·정산 예정과 정반대인데, 그것이 설계다:
 * `GET /settlements` 는 플랫폼 전체의 목록이고, `sellerId` 없이 부른 판매자는
 * **403 으로 거절된다**(F1). 그 거절이 판매자가 남의 정산서를 못 보게 막는 장치이므로
 * 여기서 id 를 빠뜨리면 화면은 「권한이 없어요」로 끝난다 — 「정산서가 없어요」가
 * 아니라. 두 문장은 판매자에게 전혀 다른 뜻이다.
 *
 * 값이 없는 축은 **키 자체를 넣지 않는다.** `undefined` 를 실어 보내면
 * `URLSearchParams` 가 `status=undefined` 를 만들고, 서버는 그것을 잘못된 상태로
 * 읽어 400 으로 답한다.
 */
export function sellerSettlementQuery(
  sellerId: string,
  filters: SellerSettlementFilters,
): SettlementListQueryParams {
  return {
    sellerId,
    // 계약의 `status` 는 목록이지만 화면이 고르는 것은 한 값이다. 문법은 쉼표 하나다.
    ...(filters.status === null ? {} : { status: [filters.status] }),
  }
}

/* ----------------------------------------------------------- 계산 근거 -- */

/**
 * 계산 근거 한 줄이 무엇인가 (F2).
 *
 * 이름이 곧 카탈로그의 열쇠다 — `Record<CalculationLineKey, string>` 이라 줄이 하나
 * 늘면 문구가 없는 것을 typecheck 이 잡는다.
 *
 * **수수료와 쿠폰 부담이 각각 한 줄이다** (3장 요구사항 5). 둘을 「차감」 한 줄로
 * 합치면 이 화면이 답하려던 물음 — 「플랫폼이 떼 간 것은 얼마고 내가 낸 것은
 * 얼마냐」 — 이 사라진다. 그 둘은 성질이 다르다: 하나는 요율이 정하고, 다른 하나는
 * 판매자 자신이 발행한 쿠폰이 정한다.
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
  /** 마지막 줄 — 위의 넷이 만나는 결과. 굵게 서고 구분선 아래에 온다. */
  readonly total: boolean
}

/**
 * `pricing.md` 6장의 식, 그대로 다섯 줄.
 *
 * ```
 * 판매액          1,890,000
 * − 플랫폼 수수료   -189,000
 * − 판매자 쿠폰      -30,000
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
 * 그려진다.
 *
 * ## 합을 다시 계산하지 않는다 (F3)
 *
 * 마지막 줄은 `payoutAmount` **그대로**다. 네 줄을 더해 그리면 화면이 서버와 다른
 * 답을 낼 수 있게 되고, 그러면 판매자 콘솔과 관리자 콘솔이 같은 정산서에 다른
 * 숫자를 적는 날이 온다 — 그때 옳은 것은 언제나 서버 쪽이다(DB 의 검사 제약이 그
 * 식을 강제한다). 화면이 할 일은 「왜 이 금액인가」를 보여 주는 것이지 그 금액을
 * **정하는** 것이 아니다.
 */
export function calculationLines(settlement: Settlement): readonly CalculationLine[] {
  return [
    { amount: settlement.salesAmount, key: 'sales', total: false },
    { amount: -settlement.commissionAmount, key: 'commission', total: false },
    { amount: -settlement.sellerCouponAmount, key: 'sellerCoupon', total: false },
    { amount: settlement.returnAdjustmentAmount, key: 'returnAdjustment', total: false },
    { amount: settlement.payoutAmount, key: 'payout', total: true },
  ]
}

/** 이 정산서를 여는 주소. 목록의 줄이 가리키는 곳이다. */
export function settlementHref(id: string): string {
  return `/settlements/${id}`
}
