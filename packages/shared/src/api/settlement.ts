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

/**
 * `POST /api/v1/settlements/batch` — 정산 배치를 손으로 한 번 돌린다 (TASK-0080).
 *
 * 스케줄러가 한 시간마다 같은 일을 한다. 이 문은 **놓친 회차를 즉시 따라잡는**
 * 자리이고, 몇 번을 눌러도 결과가 같다 — 한 판매자 몫은 한 번만 정산되고(F6), 이미
 * 적힌 차감은 다시 계산돼도 같은 값이 된다.
 */
export const settlementRunResponseSchema = z.object({
  /** 새로 만든 판매 줄. */
  settled: z.int().min(0),
  /** 승인 전이라 **고쳐 쓴** 판매 줄 (재생성). */
  amended: z.int().min(0),
  /** 이미 승인·지급된 회차 뒤에 온 반품이라 **차감 줄로 적은** 몫 (F7). */
  adjusted: z.int().min(0),
  /** 손댄 정산서의 수. */
  settlements: z.int().min(0),
})

export type SettlementRunResponse = z.infer<typeof settlementRunResponseSchema>

/**
 * 정산서가 지나는 상태 (`state-machines.md` 5장).
 *
 * **보류는 승인의 반대가 아니라 판단을 미룬 상태다.** 그래서 「거절」이 없다 — 정산은
 * 거절할 수 있는 것이 아니고, 금액이 틀렸으면 고쳐서 다음 회차에서 조정한다.
 */
export const settlementStatuses = ['PENDING', 'HOLD', 'APPROVED', 'PAID'] as const

export type SettlementStatus = (typeof settlementStatuses)[number]

export const settlementStatusSchema = z.enum(settlementStatuses)

/** 정산서 한 장. 화면이 목록과 상세에서 같은 모양으로 읽는다. */
export const settlementSchema = z.object({
  id: z.uuid(),
  sellerId: sellerIdSchema,
  /** 스토어 이름. 목록에서 id 를 읽게 하지 않는다. */
  brandName: z.string(),
  periodStart: z.iso.datetime(),
  /** **포함하지 않는 끝**이다. 다음 회차의 시작과 정확히 맞물린다. */
  periodEnd: z.iso.datetime(),
  status: settlementStatusSchema,
  /** 판매액 — **정가 기준**이다. 플랫폼 쿠폰과 적립금을 빼지 않았다 (D-029). */
  salesAmount: wonSchema,
  commissionAmount: wonSchema,
  sellerCouponAmount: wonSchema,
  /** 지난 회차 뒤에 확정된 반품의 차감. **음수이거나 0이다.** */
  returnAdjustmentAmount: z.int().max(0),
  /**
   * 실제로 줄 돈. **음수일 수 있다** — 지난 회차의 반품이 이번 주 판매보다 크면
   * 그렇게 된다. 0으로 자르면 그 차액이 사라지고, 사라진 돈은 아무 데도 나타나지
   * 않는다.
   */
  payoutAmount: z.int(),
  /** 왜 보류했나 (F4). **해소된 뒤에도 남는다** — 판매자가 묻는 것은 대개 지급 뒤다. */
  holdReason: z.string().nullable(),
  heldAt: z.iso.datetime().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  paidAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})

export type Settlement = z.infer<typeof settlementSchema>

/** 정산서의 한 줄이 무엇인가. */
export const settlementItemTypes = ['SALE', 'RETURN_ADJUSTMENT'] as const

export type SettlementItemType = (typeof settlementItemTypes)[number]

/**
 * 정산서의 한 줄 (F1 · F2).
 *
 * **주문 번호를 함께 싣는 이유가 F2 다.** 판매자가 이의를 제기했을 때 관리자는 이
 * 줄에서 그 주문으로 곧장 내려갈 수 있어야 하고, id 만으로는 그 링크를 만들 수 없다.
 */
export const settlementItemSchema = z.object({
  id: z.uuid(),
  type: z.enum(settlementItemTypes),
  sellerOrderId: z.uuid(),
  orderNumber: z.string(),
  /** 차감 줄에서는 **셋 다 음수**다. 그래서 합계가 그냥 합이 된다. */
  salesAmount: z.int(),
  commissionAmount: z.int(),
  sellerCouponAmount: z.int(),
  payoutAmount: z.int(),
  createdAt: z.iso.datetime(),
})

export type SettlementItem = z.infer<typeof settlementItemSchema>

export const SETTLEMENT_LIST_DEFAULT_LIMIT = 20
export const SETTLEMENT_LIST_MAX_LIMIT = 100

/** `GET /api/v1/settlements` — 회차·판매자·상태로 거른 목록. */
export const settlementListQueryParamsSchema = z.object({
  status: z
    .string()
    .transform((value) => value.split(','))
    .pipe(z.array(settlementStatusSchema).min(1))
    .optional(),
  sellerId: sellerIdSchema.optional(),
  /** 이 회차 하나만. 회차의 시작 시각으로 가리킨다. */
  periodStart: z.iso.datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(SETTLEMENT_LIST_MAX_LIMIT).optional(),
})

export type SettlementListQueryParams = z.infer<typeof settlementListQueryParamsSchema>

export const settlementListResponseSchema = z.object({
  settlements: z.array(settlementSchema),
  nextCursor: z.string().nullable(),
  /**
   * 지금 필터가 고른 것들의 합계 — 「이번 회차에 얼마가 나가나」.
   *
   * **페이지가 아니라 필터의 합이다.** 페이지 합으로 답하면 다음 장을 넘길 때마다
   * 총액이 달라지고, 그 숫자를 보고 지급을 결정하는 사람에게 그것은 답이 아니다.
   */
  totals: z.object({ count: z.int().min(0), payoutAmount: z.int() }),
})

export type SettlementListResponse = z.infer<typeof settlementListResponseSchema>

/** `GET /api/v1/settlements/:id` — 계산 근거를 항목별로 펼친다 (F1). */
export const settlementDetailResponseSchema = z.object({
  settlement: settlementSchema,
  items: z.array(settlementItemSchema),
})

export type SettlementDetailResponse = z.infer<typeof settlementDetailResponseSchema>

export const settlementResponseSchema = z.object({ settlement: settlementSchema })

export type SettlementResponse = z.infer<typeof settlementResponseSchema>

export const SETTLEMENT_HOLD_REASON_MAX = 500

/**
 * `POST /api/v1/settlements/:id/hold` — 분쟁·이상 건으로 보류한다 (F4).
 *
 * 사유가 **비어 있을 수 없다.** 사유 없는 보류는 판매자가 「왜 제 정산이 멈췄죠」라고
 * 물었을 때 답할 것이 없는 상태이고, 그 물음은 반드시 온다.
 */
export const holdSettlementRequestSchema = z.object({
  reason: z.string().trim().min(1).max(SETTLEMENT_HOLD_REASON_MAX),
})

export type HoldSettlementRequest = z.infer<typeof holdSettlementRequestSchema>

export const SETTLEMENT_BULK_APPROVE_MAX = 100

/** `POST /api/v1/settlements/approvals` — 한꺼번에 승인한다 (F6). */
export const bulkApproveSettlementsRequestSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(SETTLEMENT_BULK_APPROVE_MAX),
})

export type BulkApproveSettlementsRequest = z.infer<typeof bulkApproveSettlementsRequestSchema>

/** 왜 이 한 장이 승인되지 않았나. 화면이 그대로 읽어 주는 목록이다. */
export const settlementApprovalFailures = ['not_found', 'wrong_status'] as const

export type SettlementApprovalFailure = (typeof settlementApprovalFailures)[number]

/**
 * 일괄 승인의 답 (F6).
 *
 * **실패한 것을 조용히 빼지 않는다.** 「10건 골랐는데 8건이 승인됐다」를 화면이
 * 말하지 못하면, 남은 2건은 아무도 다시 보지 않는다 — 그리고 그 2건이야말로 사람이
 * 봐야 하는 것들이다.
 */
export const bulkApproveSettlementsResponseSchema = z.object({
  approved: z.array(z.uuid()),
  failed: z.array(z.object({ id: z.uuid(), reason: z.enum(settlementApprovalFailures) })),
})

export type BulkApproveSettlementsResponse = z.infer<typeof bulkApproveSettlementsResponseSchema>
