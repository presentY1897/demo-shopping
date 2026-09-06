import type {
  BulkIssueResponse,
  CouponDiscountType,
  CouponLifecycle,
  CouponListEntry,
  CouponListQueryParams,
} from '@shopping/shared'

import { dayEnd, dayStart } from '@/lib/claims/claim-console'

/**
 * 플랫폼 쿠폰 화면의 순수 판단 (TASK-0073, 6.2 Q5 「순수 로직」).
 *
 * 여기 있는 것 셋은 **틀려도 조용하다.** 예상 비용을 잘못 세면 화면은 그럴듯한
 * 숫자를 하나 그리고, 그 숫자를 보고 사람은 발행 버튼을 누른다. 「무제한 정률
 * 쿠폰의 위험을 발행 전에 인지시킨다」(TASK-0073 4장)가 이 파일의 전부이므로,
 * 계산이 아니라 **계산할 수 없다는 사실**이 이 모듈의 첫 번째 답이다.
 *
 * 상태 필터와 사용률도 같은 성질이다 — 질의를 잘못 조립하면 목록이 조용히 다른
 * 것을 보여 주고, 분모가 0인 나눗셈은 `NaN%` 를 그린다. 어느 쪽도 빨간 검사로
 * 나타나지 않는다.
 *
 * 그래서 이 파일에는 React 도 문구도 없다. 문구는 카탈로그가, 그리기는 컴포넌트가
 * 맡고, 여기 있는 것은 입력과 출력뿐이다.
 */

/** 목록을 좁히는 축 — 상태 하나와 기간의 두 끝. */
export interface PlatformCouponFilters {
  /** `null` 은 전체. 계약은 여럿을 받지만 화면이 고르는 것은 하나다. */
  readonly lifecycle: CouponLifecycle | null
  /** 사람이 고른 **날짜**(`YYYY-MM-DD`). 계약이 받는 순간으로는 아래에서 바뀐다. */
  readonly from: string | null
  readonly to: string | null
}

export const EMPTY_PLATFORM_COUPON_FILTERS: PlatformCouponFilters = {
  lifecycle: null,
  from: null,
  to: null,
}

/** 조건이 걸려 있는가 — 「비었다」와 「이 조건에 맞는 것이 없다」를 가르는 값이다. */
export function isNarrowed(filters: PlatformCouponFilters): boolean {
  return filters.lifecycle !== null || filters.from !== null || filters.to !== null
}

/**
 * 필터를 계약의 질의로. 커서와 개수는 부르는 쪽이 얹는다.
 *
 * **값이 없는 축은 키 자체를 넣지 않는다.** `undefined` 를 실어 보내면
 * `URLSearchParams` 가 `lifecycle=undefined` 를 만들고, 서버는 그것을 알 수 없는
 * 상태로 읽어 400 으로 답한다 (`lib/claims/claim-console.ts` 와 같은 규약).
 *
 * **`sellerId` 를 넣지 않는 것이 이 화면의 정의다.** 그 값이 어느 목록인지를 정하고,
 * 없는 것이 곧 「플랫폼 부담 쿠폰」이다 (`couponListQueryParamsSchema`).
 *
 * **기간은 날짜를 순간으로 편다.** 고른 날의 0시부터 끝날의 24시까지이고, 그 하루를
 * 한국 시간으로 자르는 규칙은 클레임 콘솔이 이미 갖고 있어 다시 만들지 않았다
 * (`lib/claims/claim-console.ts`) — 두 화면이 같은 날짜를 골랐을 때 같은 경계를
 * 얻어야 한다.
 */
export function queryOf(filters: PlatformCouponFilters): CouponListQueryParams {
  return {
    ...(filters.lifecycle === null ? {} : { lifecycle: [filters.lifecycle] }),
    ...(filters.from === null ? {} : { from: dayStart(filters.from) }),
    ...(filters.to === null ? {} : { to: dayEnd(filters.to) }),
  }
}

/**
 * 사람이 친 숫자, 또는 **숫자가 아니라는 사실**.
 *
 * 폼의 칸은 전부 문자열이고 계약이 받는 것은 정수다. 그 사이를 `Number()` 하나로
 * 메우면 빈 칸이 `0` 이 되고 `'1e3'` 이 1000이 된다 — 앞엣것은 「무제한」을 「0장」으로
 * 바꾸고(둘은 다른 뜻이다), 뒤엣것은 사람이 보고 있는 글자와 다른 값을 보낸다.
 * 그래서 **자릿수만 받고**, 그 밖은 전부 `null` 이다.
 *
 * 비용 계산과 폼 검사가 같은 함수를 쓰는 것이 요점이다. 파싱이 두 벌이면 「예상
 * 비용은 나오는데 발행은 거절되는」 조합이 생긴다.
 */
export function integerFrom(value: string): number | null {
  const trimmed = value.trim()

  if (trimmed === '') return null

  return /^\d+$/.test(trimmed) ? Number(trimmed) : null
}

/**
 * 예상 비용을 낼 수 없게 만드는 것.
 *
 * 둘 다 **무한대**를 뜻하지만 사람이 할 일이 다르다. 상한이 없는 정률 쿠폰은
 * 「최대 할인 금액」을 채우면 되고, 수량이 무제한인 쿠폰은 「발급 수량」을 채우면
 * 된다. 하나로 뭉쳐 「계산할 수 없습니다」라고만 말하는 화면은 그 둘 모두에게
 * 무엇을 하라는 말을 하지 못한다.
 */
export const couponCostGaps = ['no_ceiling', 'no_limit'] as const

export type CouponCostGap = (typeof couponCostGaps)[number]

/**
 * 발행 전에 알 수 있는 최대 비용.
 *
 * 셋으로 나뉘는 이유는 **틀린 숫자보다 숫자가 없는 편이 낫기** 때문이다.
 *
 * - `incomplete` — 아직 채워지지 않았다. 아무 말도 하지 않는다.
 * - `unbounded` — 계산할 수 없다. **그 사실과 이유**를 말한다.
 * - `estimated` — 「수량 × 한 장당 최대」. 실제 비용은 이보다 작다(안 쓰는 사람이
 *   있고, 정률은 상한에 닿지 않는 주문이 많다). 상한이지 예측이 아니다.
 */
export type CouponCostEstimate =
  | { readonly kind: 'incomplete' }
  | { readonly kind: 'unbounded'; readonly gaps: readonly CouponCostGap[] }
  | {
      readonly kind: 'estimated'
      /** 한 장이 최대로 깎을 수 있는 금액. */
      readonly perCoupon: number
      /** 준비된 수량. 곱셈의 다른 쪽이라 화면이 합계에서 되계산하지 않는다. */
      readonly count: number
      /** 그것이 준비된 수량만큼 전부 쓰였을 때. */
      readonly total: number
    }

/** 폼이 지금 들고 있는, 비용에 관계된 값들. 비어 있는 칸은 `null` 이다. */
export interface CouponCostInput {
  /** 아직 고르지 않았으면 `null`. */
  readonly discountType: CouponDiscountType | null
  readonly discountValue: number | null
  /** 정률의 상한. 정액에서는 뜻이 없다. */
  readonly maxDiscountAmount: number | null
  /** `null` 은 무제한 — 그 자체가 「셀 수 없다」의 절반이다. */
  readonly issueLimit: number | null
}

/**
 * 발급 수량 × 최대 할인액 (F3).
 *
 * **정률 쿠폰의 최대 할인액은 상한이지 할인율이 아니다.** 10% 쿠폰 한 장이 얼마를
 * 깎을지는 주문 금액이 정하고 그 금액에는 위가 없으므로, 상한이 없는 정률 쿠폰의
 * 최대 비용은 **무한대**다. 그 자리에 「10 × 1000 = 10,000원」 같은 숫자를 적으면
 * 그것은 계산이 아니라 거짓말이다 — 퍼센트와 원을 곱한 값에는 아무 뜻이 없다.
 *
 * 수량이 무제한인 쿠폰도 같은 이유로 답이 없다. 두 구멍은 **함께** 열릴 수 있으므로
 * 어느 하나를 먼저 고르지 않고 둘 다 돌려준다.
 */
export function estimateCouponCost(input: CouponCostInput): CouponCostEstimate {
  if (input.discountType === null || input.discountValue === null || input.discountValue <= 0) {
    return { kind: 'incomplete' }
  }

  const perCoupon = input.discountType === 'FIXED' ? input.discountValue : input.maxDiscountAmount

  const gaps = [
    ...(perCoupon === null ? (['no_ceiling'] as const) : []),
    ...(input.issueLimit === null ? (['no_limit'] as const) : []),
  ]

  if (perCoupon === null || input.issueLimit === null) return { gaps, kind: 'unbounded' }

  return {
    count: input.issueLimit,
    kind: 'estimated',
    perCoupon,
    total: perCoupon * input.issueLimit,
  }
}

/**
 * 발급된 장 가운데 실제로 쓰인 비율 — **정수 퍼센트**.
 *
 * 한 장도 나가지 않은 쿠폰이 분모 0이다. 그대로 나누면 `NaN%` 가 화면에 남고, 그것은
 * 「0%」와 달리 사람에게 아무것도 말하지 않는다. 아직 나간 것이 없으면 쓰인 비율도
 * 0이라고 말하는 편이 정확하다.
 */
export function usageRate(entry: CouponListEntry): number {
  const issued = entry.coupon.issuedCount

  return issued === 0 ? 0 : Math.round((entry.stats.usedCount / issued) * 100)
}

/**
 * 이 쿠폰에 아직 지급할 수 있는가.
 *
 * **서버가 거절하는 둘을 그대로 막는다** (`CouponConsoleService.bulkIssue`): 끝난
 * 쿠폰과 멈춘 쿠폰이다. 뒤엣것은 한동안 서버가 열어 두던 자리였고 그때는 화면도
 * 열어 두었다 — 중단의 뜻이 「더 나가지 않게」인데 한 장씩만 막고 한꺼번에는 열려
 * 있으면 그 뜻이 문마다 달라지므로, 서버가 닫으면서 화면도 함께 닫는다.
 *
 * 화면이 서버보다 **더** 엄격해지지 않는 것이 이 함수의 규칙이다. 소진된 쿠폰에도
 * 버튼이 남아 있는 이유가 그것이다: 그 요청은 「0장 나갔다」로 정상 응답하고,
 * 그때 발행자가 알아야 할 것은 거절이 아니라 **수량이 다 찼다**는 사실이다.
 */
export function mayBulkIssue(lifecycle: CouponLifecycle): boolean {
  return lifecycle !== 'ENDED' && lifecycle !== 'SUSPENDED'
}

/**
 * 한 번의 일괄 지급이 실제로 무슨 일이었나.
 *
 * 세 숫자를 **네 가지 사건**으로 읽는다. 「0장 나갔습니다」가 세 가지 서로 다른 일을
 * 뜻하기 때문이고, 그 셋에 발행자가 할 일이 전부 다르다.
 *
 * | 답 | 무슨 일인가 | 발행자가 할 일 |
 * | --- | --- | --- |
 * | `issued` | 나갔다 | 남았으면 한 번 더 |
 * | `all_held` | 조건에 맞는 사람이 이미 전부 갖고 있다 | 없다 |
 * | `quantity_gone` | 준비한 수량이 다 찼다 | 새 쿠폰을 낸다 |
 * | `nobody` | 조건에 맞는 사람이 없다 | 대상을 바꾼다 |
 *
 * 순서가 규칙이다. 한 장이라도 나갔으면 그것이 먼저이고, 나가지 않았을 때 「이미
 * 갖고 있다」가 「수량이 없다」를 가린다 — 이미 다 가진 사람들에게 수량 이야기를
 * 하면 발행자는 수량을 늘리러 간다.
 */
export const bulkIssueOutcomes = ['issued', 'all_held', 'quantity_gone', 'nobody'] as const

export type BulkIssueOutcome = (typeof bulkIssueOutcomes)[number]

export function bulkIssueOutcomeOf(result: BulkIssueResponse): BulkIssueOutcome {
  if (result.issued > 0) return 'issued'
  if (result.skipped > 0) return 'all_held'

  // 남은 대상이 있는데 한 장도 나가지 않았다면 막은 것은 수량이다 — 대상이 없어서가
  // 아니다 (`remaining` 은 개수가 아니라 「더 있다」는 뜻이다).
  return result.remaining > 0 ? 'quantity_gone' : 'nobody'
}

/**
 * 문장에 넣을 수 — 사건마다 **다른 숫자**를 가리킨다.
 *
 * 나갔으면 나간 수이고, 모두 갖고 있으면 그 사람 수다. 나머지 둘에는 셀 것이 없다.
 */
export function bulkIssueCountOf(outcome: BulkIssueOutcome, result: BulkIssueResponse): number {
  if (outcome === 'issued') return result.issued

  return outcome === 'all_held' ? result.skipped : 0
}
