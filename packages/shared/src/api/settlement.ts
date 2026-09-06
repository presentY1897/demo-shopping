import { z } from 'zod'

import { categoryIdSchema } from './categories.js'
import { sellerIdSchema } from './sellers.js'
import { wonSchema } from '../pricing/types.js'

/**
 * 정산의 계약 (M12).
 *
 * `docs/design/pricing.md` 6장이 이 마일스톤의 명세다:
 *
 * ```
 * 지급액 = 판매액 − 플랫폼 수수료 − 판매자 부담 쿠폰 − 반품 차감
 * ```
 *
 * **앞서 정한 것들이 전부 여기서 만난다** (D-032). 쿠폰의 부담 주체(D-029)가 세 번째
 * 항을 만들고, 구매확정이 첫 번째 항의 조건이며, 반품이 네 번째를 만든다.
 */

/**
 * 요율의 단위 — basis point (1bp = 0.01%).
 *
 * 금액이 정수(원)인데 비율만 부동소수면 정산에서 `0.1 + 0.2` 류의 오차가 다시
 * 들어온다. bp 는 국내 커머스 수수료가 쓰는 해상도(3.5%, 12.75%)를 정확히 표현하면서
 * 정수로 남는다 (`erd.md` 1장).
 */
export const COMMISSION_RATE_MAX_BP = 10_000

export const commissionRateBpSchema = z.int().min(0).max(COMMISSION_RATE_MAX_BP)

/**
 * 요율이 걸린 자리 — **좁은 것부터**.
 *
 * 목록의 순서가 곧 우선순위다 (`pricing.md` 6장). 판매자 개별율이 카테고리 기본율을
 * 이기고, 카테고리가 전역을 이긴다 — 개별 계약이 기본값을 이긴다는 한 문장이다.
 */
export const commissionScopes = ['seller', 'category', 'global'] as const

export type CommissionScope = (typeof commissionScopes)[number]

export const commissionScopeSchema = z.enum(commissionScopes)

/**
 * 요율 한 벌.
 *
 * **행이 곧 이력이다.** 요율을 바꾸는 것은 행을 고치는 일이 아니라 지금 열린 행을
 * 닫고 새 행을 여는 일이라, 「변경 이력」이 따로 만들어야 할 것이 아니라 이 목록을
 * 시간순으로 읽은 결과다.
 */
export const commissionRateSchema = z.object({
  id: z.uuid(),
  /** 스토어에 걸렸으면 그 id. 카테고리와 **동시에 채워지지 않는다**. */
  sellerId: sellerIdSchema.nullable(),
  categoryId: categoryIdSchema.nullable(),
  scope: commissionScopeSchema,
  rateBp: commissionRateBpSchema,
  validFrom: z.iso.datetime(),
  /** `null` 이면 **지금 유효한 행**이다. 범위마다 하나뿐이다. */
  validUntil: z.iso.datetime().nullable(),
  /** 누가 바꿨나 (F5). 관리자 콘솔만 읽는 값이다. */
  createdBy: z.object({ id: z.uuid(), email: z.string() }),
  createdAt: z.iso.datetime(),
})

export type CommissionRate = z.infer<typeof commissionRateSchema>

/** `GET /api/v1/commission-rates` — 지금 유효한 요율들, 그리고 한 범위의 이력. */
export const commissionRateListQueryParamsSchema = z.object({
  /**
   * 한 범위의 **이력**을 볼 때만 준다. 없으면 지금 열려 있는 요율 전부다.
   *
   * 목록과 이력을 한 라우트에 둔 이유는 **답의 모양이 같기** 때문이다 — 둘 다
   * 요율의 목록이고, 다른 것은 「지금」인가 「지나온 것 전부」인가뿐이다.
   */
  sellerId: sellerIdSchema.optional(),
  categoryId: z.coerce.number().pipe(categoryIdSchema).optional(),
  /**
   * `true` 면 **한 범위의** 지나온 요율 전부.
   *
   * 범위를 함께 주지 않은 이력 요청은 **전역 요율의 이력**이다 — 전역은 「스토어도
   * 카테고리도 아닌 자리」라, 그것을 가리키는 방법이 빈칸 말고는 없다.
   */
  history: z.stringbool().optional(),
})

export type CommissionRateListQueryParams = z.infer<typeof commissionRateListQueryParamsSchema>

export const commissionRateListResponseSchema = z.object({
  rates: z.array(commissionRateSchema),
  /**
   * 아무 요율도 설정되지 않았을 때 쓰이는 값.
   *
   * **0이 아니다.** 「설정을 안 했다」와 「수수료를 받지 않기로 했다」는 다른
   * 결정이고, 폴백을 0으로 두면 설정을 잊은 카테고리에서 플랫폼이 조용히 아무것도
   * 받지 않는다. 화면이 이 값을 그려야 「아직 정하지 않았다」가 보인다.
   */
  fallbackRateBp: commissionRateBpSchema,
})

export type CommissionRateListResponse = z.infer<typeof commissionRateListResponseSchema>

/**
 * `PUT /api/v1/commission-rates` — 한 범위의 요율을 바꾼다.
 *
 * `PUT` 인 이유는 **범위마다 요율이 하나**이기 때문이다. 새 행을 만드는 것처럼
 * 보이지만 부르는 쪽이 정하는 것은 「이 범위는 이제 몇 퍼센트인가」 하나이고, 행이
 * 늘어나는 것은 이력을 남기는 방식일 뿐이다.
 */
export const setCommissionRateRequestSchema = z
  .object({
    sellerId: sellerIdSchema.nullable().default(null),
    categoryId: categoryIdSchema.nullable().default(null),
    rateBp: commissionRateBpSchema,
  })
  // 둘 다 채워진 요청은 「이 카테고리의 이 판매자」라는 네 번째 범위를 뜻하는데, 그런
  // 것을 만들려면 우선순위 규칙을 다시 정해야 한다. DB 도 같은 것을 막는다.
  .refine(
    (input) => input.sellerId === null || input.categoryId === null,
    '스토어와 카테고리를 동시에 지정할 수 없어요.',
  )

export type SetCommissionRateRequest = z.infer<typeof setCommissionRateRequestSchema>

export const commissionRateResponseSchema = z.object({ rate: commissionRateSchema })

export type CommissionRateResponse = z.infer<typeof commissionRateResponseSchema>

/** 시뮬레이션이 돌아보는 기간 — 지난 30일. */
export const COMMISSION_SIMULATION_DAYS = 30

/**
 * `GET /api/v1/commission-rates/simulation` — 이 요율로 바꾸면 얼마가 달라지나 (F6).
 *
 * **과거 주문에는 아무 영향이 없다.** 주문 시점의 요율이 항목에 박혀 있으므로(F4)
 * 요율을 바꿔도 이미 판 것의 수수료는 변하지 않는다. 그래서 이 미리보기가 답하는
 * 것은 「**앞으로** 이만큼 달라진다」이고, 그 추정의 근거로 지난 30일의 실제 판매를
 * 쓴다 — 아무 근거 없는 예상 숫자보다 「지난달에 이랬다면」이 읽는 사람에게 훨씬
 * 정확한 감각을 준다.
 */
export const commissionSimulationQueryParamsSchema = z.object({
  sellerId: sellerIdSchema.optional(),
  categoryId: z.coerce.number().pipe(categoryIdSchema).optional(),
  rateBp: z.coerce.number().pipe(commissionRateBpSchema),
})

export type CommissionSimulationQueryParams = z.infer<typeof commissionSimulationQueryParamsSchema>

export const commissionSimulationResponseSchema = z.object({
  /** 이 추정이 돌아본 기간의 판매액. 0이면 비교할 것이 없다. */
  salesAmount: wonSchema,
  /** 그 판매액에 **지금 요율**을 적용했을 때의 수수료. */
  currentAmount: wonSchema,
  /** **제안한 요율**을 적용했을 때의 수수료. */
  proposedAmount: wonSchema,
  /** 돌아본 몫의 수. 0이면 화면은 숫자 대신 「비교할 판매가 없다」를 말한다. */
  sellerOrderCount: z.int().min(0),
})

export type CommissionSimulationResponse = z.infer<typeof commissionSimulationResponseSchema>
