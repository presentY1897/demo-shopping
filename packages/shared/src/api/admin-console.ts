import { z } from 'zod'

import { adminReasonSchema } from './admin-users.js'
import { orderStatusSchema } from './orders.js'
import { productIdSchema } from './products.js'
import { sellerIdSchema, sellerStatusSchema } from './sellers.js'
import { wonSchema } from '../pricing/types.js'

/**
 * 판매자 관리 · 전체 조회 · 데모 관리 (TASK-0094 · 0095 · 0096).
 *
 * 셋을 한 파일에 두는 이유는 셋 다 **관리자가 플랫폼 전체를 가로질러 보는 화면**의
 * 계약이기 때문이다. 도메인 계약(주문·상품·판매자)은 각자의 파일에 이미 있고, 여기
 * 있는 것은 그것들을 관리자의 축으로 다시 묻는 모양뿐이다.
 */

export const ADMIN_LIST_DEFAULT_LIMIT = 20
export const ADMIN_LIST_MAX_LIMIT = 100

// ---------------------------------------------------------------- 판매자 관리

export const sellerSortKeys = ['recent', 'sales', 'claimRate'] as const

export type SellerSortKey = (typeof sellerSortKeys)[number]

export const sellerSortKeySchema = z.enum(sellerSortKeys)

export const adminSellerListQueryParamsSchema = z.object({
  status: sellerStatusSchema.optional(),
  isDemo: z.boolean().optional(),
  sort: sellerSortKeySchema.optional(),
  cursor: z.string().max(64).optional(),
  limit: z.int().min(1).max(ADMIN_LIST_MAX_LIMIT).optional(),
})

export type AdminSellerListQueryParams = z.infer<typeof adminSellerListQueryParamsSchema>

/**
 * 스토어 하나의 지표 (TASK-0094 F1).
 *
 * **클레임률은 정수 100배다** — 3.5% 가 `350` 이다. 소수를 실어 보내면 화면마다
 * 반올림이 달라지고, 두 화면이 같은 스토어를 다른 수로 그린다 (평점이 이미 같은
 * 판단을 했다: `ratingAvg` 도 100배 정수다).
 *
 * 주문이 없으면 `null` 이다. 0이 아니다 — 「클레임이 한 건도 없는 좋은 스토어」와
 * 「아직 아무것도 안 판 스토어」는 다른 사실이고, 0으로 두면 신규 스토어가 목록의
 * 맨 위에 올라온다.
 */
export const adminSellerMetricsSchema = z.object({
  salesAmount: wonSchema,
  orderCount: z.int().min(0),
  claimCount: z.int().min(0),
  claimRateBp: z.int().min(0).nullable(),
  ratingAvg: z.int().min(0).max(500),
  ratingCount: z.int().min(0),
  productCount: z.int().min(0),
})

export type AdminSellerMetrics = z.infer<typeof adminSellerMetricsSchema>

export const adminSellerRowSchema = z.object({
  sellerId: sellerIdSchema,
  brandName: z.string(),
  status: sellerStatusSchema,
  /** 데모 계정이 만든 스토어인가 (F7). 지표를 읽을 때 섞이면 안 되는 줄이다. */
  isDemo: z.boolean(),
  followerCount: z.int().min(0),
  createdAt: z.iso.datetime(),
  metrics: adminSellerMetricsSchema,
})

export type AdminSellerRow = z.infer<typeof adminSellerRowSchema>

export const adminSellerListResponseSchema = z.object({
  sellers: z.array(adminSellerRowSchema),
  nextCursor: z.string().nullable(),
})

export type AdminSellerListResponse = z.infer<typeof adminSellerListResponseSchema>

/**
 * 제재 이력 한 줄 (F6).
 *
 * `Seller` 는 **지금** 상태와 사유만 들고 있어, 정지와 해제를 반복하면 앞의 것이
 * 덮인다 — 그러면 반복 위반과 한 번의 실수를 구별할 수 없다.
 */
export const sellerStatusEventSchema = z.object({
  id: z.uuid(),
  fromStatus: sellerStatusSchema.nullable(),
  toStatus: sellerStatusSchema,
  reason: z.string().nullable(),
  /** 시스템이 옮긴 것이면 `null`. */
  actorId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
})

export type SellerStatusEvent = z.infer<typeof sellerStatusEventSchema>

export const sellerStatusHistoryResponseSchema = z.object({
  events: z.array(sellerStatusEventSchema),
})

export type SellerStatusHistoryResponse = z.infer<typeof sellerStatusHistoryResponseSchema>

// ------------------------------------------------------------- 상품 강제 숨김

/**
 * 관리자가 상품을 내린다 (TASK-0095 F2 · F3).
 *
 * 내리는 **동작**은 신고 처리와 같다 — 판매를 멈춘다. 다른 것은 근거가 어디 있는가다:
 * 신고를 통한 숨김은 신고 행이 사유를 들고 있지만, 직접 내리는 데에는 가리킬 행이
 * 없어 여기서 받는다. 사유 없이 내려진 상품은 **판매자에게 설명할 방법이 없다.**
 */
export const hideProductRequestSchema = z.object({ reason: adminReasonSchema })

export type HideProductRequest = z.infer<typeof hideProductRequestSchema>

export const productModerationSchema = z.object({
  productId: productIdSchema,
  hidden: z.boolean(),
  moderatedAt: z.iso.datetime().nullable(),
  moderationReason: z.string().nullable(),
})

export type ProductModeration = z.infer<typeof productModerationSchema>

export const productModerationResponseSchema = z.object({ product: productModerationSchema })

export type ProductModerationResponse = z.infer<typeof productModerationResponseSchema>

// ------------------------------------------------------------------ 주문 조회

export const adminOrderSearchQueryParamsSchema = z.object({
  /** 주문번호. CS 가 가장 먼저 손에 쥐는 값이라 **정확히 일치**로 찾는다. */
  orderNumber: z.string().trim().min(1).max(40).optional(),
  buyerId: z.uuid().optional(),
  sellerId: sellerIdSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  cursor: z.string().max(64).optional(),
  limit: z.int().min(1).max(ADMIN_LIST_MAX_LIMIT).optional(),
})

export type AdminOrderSearchQueryParams = z.infer<typeof adminOrderSearchQueryParamsSchema>

export const adminOrderRowSchema = z.object({
  orderId: z.uuid(),
  orderNumber: z.string(),
  /** 산 사람은 **가려서** 나간다 — 주문 목록은 훑어보는 화면이다 (TASK-0093 F6 과 같은 판단). */
  maskedBuyerName: z.string(),
  paidAmount: wonSchema,
  createdAt: z.iso.datetime(),
  /** 판매자별 묶음 전부 (F5). 하나만 보이면 다중 판매자 주문의 절반이 사라진다. */
  sellerOrders: z.array(
    z.object({
      sellerOrderId: z.uuid(),
      sellerId: sellerIdSchema,
      brandName: z.string(),
      status: orderStatusSchema,
      paidAmount: wonSchema,
    }),
  ),
})

export type AdminOrderRow = z.infer<typeof adminOrderRowSchema>

export const adminOrderSearchResponseSchema = z.object({
  orders: z.array(adminOrderRowSchema),
  nextCursor: z.string().nullable(),
})

export type AdminOrderSearchResponse = z.infer<typeof adminOrderSearchResponseSchema>

/** 결제와 환불 (F6). 「돈이 어떻게 움직였나」에 한 화면에서 답한다. */
export const adminOrderPaymentSchema = z.object({
  paymentId: z.uuid(),
  provider: z.string(),
  status: z.string(),
  amount: wonSchema,
  canceledAmount: wonSchema,
  approvedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})

export type AdminOrderPayment = z.infer<typeof adminOrderPaymentSchema>

export const adminOrderPaymentsResponseSchema = z.object({
  payments: z.array(adminOrderPaymentSchema),
  refundedAmount: wonSchema,
})

export type AdminOrderPaymentsResponse = z.infer<typeof adminOrderPaymentsResponseSchema>

// ------------------------------------------------------------------ 데모 관리

export const demoPolicySchema = z.object({
  ttlHours: z.int().min(1).max(720),
  seedOrders: z.int().min(0).max(50),
  virtualCardLimit: z.int().min(1_000).max(100_000_000),
})

export type DemoPolicy = z.infer<typeof demoPolicySchema>

export const demoPolicyResponseSchema = z.object({ policy: demoPolicySchema })

export type DemoPolicyResponse = z.infer<typeof demoPolicyResponseSchema>

/**
 * 관리자가 보는 데모 계정 한 줄.
 *
 * 발급 응답의 `demoAccountSchema`(`api/demo.ts`)와 **다른 것이다.** 저쪽은 방금 받은
 * 사람에게 「언제까지 쓸 수 있나」를 말하고, 이쪽은 운영자에게 「이 계정이 어떤
 * 상태인가」를 말한다 — 정리 실패 이유는 저쪽에 있을 이유가 없고, 있으면 데모를
 * 눌러 본 사람에게 내부 오류 문구가 나간다.
 */
export const adminDemoAccountSchema = z.object({
  userId: z.uuid(),
  roles: z.array(z.string()),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
  /** 정리가 마지막으로 실패한 이유. 없으면 `null` (TASK-0096 F4). */
  cleanupError: z.string().nullable(),
  cleanupFailedAt: z.iso.datetime().nullable(),
})

export type AdminDemoAccount = z.infer<typeof adminDemoAccountSchema>

export const demoAccountListResponseSchema = z.object({
  accounts: z.array(adminDemoAccountSchema),
  nextCursor: z.string().nullable(),
})

export type DemoAccountListResponse = z.infer<typeof demoAccountListResponseSchema>

export const demoStatsDaySchema = z.object({
  date: z.iso.date(),
  issued: z.int().min(0),
})

export type DemoStatsDay = z.infer<typeof demoStatsDaySchema>

/** 발급 통계 (F7). 일별과 역할별을 함께 답한다 — 두 축을 따로 물으면 합이 안 맞는다. */
/**
 * 지금 한 번 정리했을 때의 결과 (TASK-0096 F5).
 *
 * **계약에 있어야 하는 이유**: 없으면 화면이 응답 모양을 자기 파일에 다시 적게 되고,
 * 그것이 게이트 C1 이 금지하는 「앱이 응답 타입을 다시 정의하는 것」이다 — 서버가
 * 칸을 하나 더 보내기 시작해도 그 앱만 모른다.
 */
export const demoSweepResponseSchema = z.object({
  swept: z.int().min(0),
  /** 실패한 계정은 만료된 채로 남아 다음 주기가 다시 집는다. */
  failed: z.int().min(0),
})

export type DemoSweepResponse = z.infer<typeof demoSweepResponseSchema>

/** 발급 통계의 기본 기간과 상한. 서버가 넘치는 기간을 **조용히 접으므로** 화면이 알아야 한다. */
export const DEMO_STATS_DEFAULT_DAYS = 14
export const DEMO_STATS_MAX_DAYS = 90

export const demoStatsResponseSchema = z.object({
  days: z.array(demoStatsDaySchema),
  byRole: z.record(z.string(), z.int().min(0)),
  activeAccounts: z.int().min(0),
  failedCleanups: z.int().min(0),
})

export type DemoStatsResponse = z.infer<typeof demoStatsResponseSchema>
