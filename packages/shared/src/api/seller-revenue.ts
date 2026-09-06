import { z } from 'zod'

import { sellerIdSchema } from './sellers.js'
import { wonSchema } from '../pricing/types.js'

/**
 * 판매자의 매출과 정산 예정 (TASK-0082).
 *
 * **판매자 콘솔의 완성 지점**이고, 답하는 질문은 「내가 얼마 벌었나」 하나다. 그런데
 * 그 하나가 **두 개의 시계**를 갖는다:
 *
 * | 무엇 | 언제를 기준으로 세나 | 왜 |
 * | --- | --- | --- |
 * | 매출 | **주문이 일어난 날** | 「어제 얼마 팔았나」가 판매자가 매일 묻는 질문이다 |
 * | 정산 | **구매확정된 날** | 돈이 확정되는 시점이 그때다 (`pricing.md` 6장) |
 *
 * 둘을 하나로 합치지 않는 이유는 **합치면 둘 다 틀리기** 때문이다. 주문 기준으로
 * 정산하면 아직 확정되지 않은 돈을 받을 것처럼 말하게 되고, 확정 기준으로 매출을
 * 그리면 오늘 판 것이 일주일 뒤 그래프에 나타난다.
 */

/** 하루치 매출 한 칸. */
export const revenueDaySchema = z.object({
  /** `YYYY-MM-DD` — **KST 달력 날짜**다. */
  date: z.string(),
  salesAmount: wonSchema,
  orderCount: z.int().min(0),
})

export type RevenueDay = z.infer<typeof revenueDaySchema>

/** 한 기간의 합. 비교에도 같은 모양을 쓴다. */
export const revenueTotalsSchema = z.object({
  salesAmount: wonSchema,
  orderCount: z.int().min(0),
  /**
   * 평균 주문금액. 주문이 없으면 **0이다**.
   *
   * 나눗셈을 화면에 맡기지 않는 이유는 0으로 나누는 자리를 읽는 쪽마다 만들게 되기
   * 때문이다. 여기서 한 번 정하면 그 갈래가 한 곳에만 있다.
   */
  averageOrderAmount: wonSchema,
})

export type RevenueTotals = z.infer<typeof revenueTotalsSchema>

/** 많이 팔린 상품 한 줄. */
export const revenueProductSchema = z.object({
  productId: z.uuid(),
  productName: z.string(),
  quantity: z.int().min(0),
  salesAmount: wonSchema,
})

export type RevenueProduct = z.infer<typeof revenueProductSchema>

export const REVENUE_MAX_DAYS = 180
export const REVENUE_TOP_PRODUCTS = 5

/**
 * `GET /api/v1/seller-revenue` — 기간별 매출.
 *
 * 경계는 **양쪽 다 포함**이고 KST 달력 날짜다 — 주문 목록·쿠폰 목록과 같은 규약이라,
 * 두 화면이 같은 날짜를 골랐을 때 같은 경계를 얻는다.
 */
export const sellerRevenueQueryParamsSchema = z.object({
  sellerId: sellerIdSchema.optional(),
  /** `YYYY-MM-DD`. 주지 않으면 오늘까지의 최근 30일이다. */
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u)
    .optional(),
})

export type SellerRevenueQueryParams = z.infer<typeof sellerRevenueQueryParamsSchema>

export const sellerRevenueResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  /**
   * 기간 안의 **모든 날**이 한 칸씩 있다 — 판매가 없던 날도 0으로.
   *
   * 빈 날을 빼면 그래프가 그 구간을 건너뛰어 그리고, 「이 주에 3일 쉬었다」가
   * 「매출이 완만했다」로 보인다. 빈 칸을 채우는 일을 화면마다 다시 하게 두지도 않는다.
   */
  days: z.array(revenueDaySchema),
  totals: revenueTotalsSchema,
  /**
   * **바로 앞의 같은 길이 기간** (F6). 30일을 보면 그 앞 30일이다.
   *
   * 「전주 대비」를 서버가 정하는 이유는 증감률의 분모가 화면마다 달라지면 안 되기
   * 때문이다. 그 분모가 0이면 증감률은 **없다** — 화면이 「+∞%」를 그리지 않도록
   * 여기서는 숫자만 주고 비율은 주지 않는다.
   */
  previous: revenueTotalsSchema,
  topProducts: z.array(revenueProductSchema),
})

export type SellerRevenueResponse = z.infer<typeof sellerRevenueResponseSchema>

/** 아직 정산서에 실리지 않은 돈 한 덩이. */
export const settlementOutlookStageSchema = z.object({
  /** 이 단계에 걸려 있는 판매자 몫의 수. */
  sellerOrderCount: z.int().min(0),
  /**
   * 지금 정산된다면 받게 될 금액 — 수수료와 판매자 부담 쿠폰을 뺀 값이다.
   *
   * **정산서가 쓰는 것과 같은 계산**이라 나중에 실제 정산서와 어긋나지 않는다.
   * 반품이 그 사이에 생기면 줄어들 수 있고, 늘어나지는 않는다.
   */
  payoutAmount: z.int(),
})

export type SettlementOutlookStage = z.infer<typeof settlementOutlookStageSchema>

/**
 * `GET /api/v1/seller-settlement-outlook` — 정산 예정 금액 (F4).
 *
 * **두 단계로 나눈다.** 하나로 합치면 「받기로 확정된 돈」과 「아직 취소될 수 있는
 * 돈」이 같은 숫자에 섞이고, 판매자는 그 합을 확정된 금액으로 읽는다.
 */
export const settlementOutlookResponseSchema = z.object({
  /** 배송완료됐으나 **구매확정 전**. 아직 반품될 수 있다. */
  awaitingConfirmation: settlementOutlookStageSchema,
  /** 구매확정됐으나 **정산서 생성 전**. 다음 회차에 실린다. */
  awaitingSettlement: settlementOutlookStageSchema,
})

export type SettlementOutlookResponse = z.infer<typeof settlementOutlookResponseSchema>
