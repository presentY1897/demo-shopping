import { z } from 'zod'

import { roleSchema } from '../auth/roles.js'
import { wonSchema } from '../pricing/types.js'

/**
 * 관리자 회원 관리 (TASK-0093).
 *
 * ## 목록은 가리고, 상세는 사유를 받는다
 *
 * 운영에는 개인정보를 봐야 하는 일이 **실제로 있다.** 그래서 이 계약이 하는 일은
 * 막는 것이 아니라 **가르는 것**이다 — 훑어보는 일(목록)에는 가려진 값으로 충분하고,
 * 가리지 않은 값이 필요한 순간(상세)에는 왜 필요한지 적게 한다.
 *
 * 막을 수 없는 접근을 막는 척하면 두 가지가 나쁘다: 일을 못 하게 되거나, 사람들이
 * 우회로를 찾는다. 남는 답은 「누가 언제 왜 봤는지 남긴다」뿐이다.
 */

export const ADMIN_USER_LIST_DEFAULT_LIMIT = 20
export const ADMIN_USER_LIST_MAX_LIMIT = 100

/** 사유는 비워 둘 수 없다. 상한이 있는 것은 자유 서술이 로그를 삼키지 않게 하기 위해서다. */
export const ADMIN_REASON_MAX = 200

export const adminReasonSchema = z.string().trim().min(1).max(ADMIN_REASON_MAX)

/** 검색어의 상한. 화면의 입력 칸이 같은 수를 써야 400 대신 그 자리에서 막힌다. */
export const USER_SEARCH_MAX = 120

export const adminUserListQueryParamsSchema = z.object({
  /** 이메일 또는 이름의 일부. **가려진 값이 아니라 원본을 찾는다** — 아니면 검색이 안 된다. */
  q: z.string().trim().min(1).max(USER_SEARCH_MAX).optional(),
  role: roleSchema.optional(),
  isDemo: z.boolean().optional(),
  suspended: z.boolean().optional(),
  cursor: z.string().max(64).optional(),
  limit: z.int().min(1).max(ADMIN_USER_LIST_MAX_LIMIT).optional(),
})

export type AdminUserListQueryParams = z.infer<typeof adminUserListQueryParamsSchema>

/**
 * 목록의 한 줄. **가려진 값만 있다** (F6).
 *
 * 서버가 가려서 내려보낸다. 화면마다 가리게 두면 한 화면이 잊는 날 그 화면만 전부
 * 보여 주고, 그때 증상은 오류가 아니라 **이미 공개된 개인정보**다 (D-246 이 리뷰
 * 작성자 이름에 대해 같은 판단을 먼저 했다).
 */
export const adminUserSummarySchema = z.object({
  id: z.uuid(),
  /** `hong***@example.com` */
  maskedEmail: z.string(),
  /** `홍*동` */
  maskedName: z.string(),
  roles: z.array(roleSchema),
  isDemo: z.boolean(),
  suspendedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  lastLoginAt: z.iso.datetime().nullable(),
})

export type AdminUserSummary = z.infer<typeof adminUserSummarySchema>

export const adminUserListResponseSchema = z.object({
  users: z.array(adminUserSummarySchema),
  nextCursor: z.string().nullable(),
})

export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>

/** 상세를 열 때 함께 보내는 사유 (F7). 이 값이 열람 기록에 그대로 남는다. */
export const viewUserRequestSchema = z.object({ reason: adminReasonSchema })

export type ViewUserRequest = z.infer<typeof viewUserRequestSchema>

/**
 * 이 회원이 이 서비스에서 무엇을 했는가 (F2).
 *
 * 숫자만 싣는다. 주문 목록이나 리뷰 본문까지 여기서 내려보내면 「요약을 보려고 연
 * 화면」이 사실상 그 사람의 전부를 여는 화면이 되고, 열람 기록 하나가 그 전부를
 * 덮게 된다 — 필요하면 각 도메인의 화면에서 그 사람을 조건으로 다시 찾는다.
 */
export const adminUserStatsSchema = z.object({
  orderCount: z.int().min(0),
  paidAmount: wonSchema,
  reviewCount: z.int().min(0),
  questionCount: z.int().min(0),
  pointBalance: wonSchema,
  couponCount: z.int().min(0),
})

export type AdminUserStats = z.infer<typeof adminUserStatsSchema>

export const adminUserDetailSchema = z.object({
  id: z.uuid(),
  /** 가리지 않은 값. 이 응답을 받은 것이 곧 열람이다. */
  email: z.string(),
  name: z.string(),
  roles: z.array(roleSchema),
  isDemo: z.boolean(),
  suspendedAt: z.iso.datetime().nullable(),
  suspendedReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastLoginAt: z.iso.datetime().nullable(),
  stats: adminUserStatsSchema,
})

export type AdminUserDetail = z.infer<typeof adminUserDetailSchema>

export const adminUserDetailResponseSchema = z.object({ user: adminUserDetailSchema })

export type AdminUserDetailResponse = z.infer<typeof adminUserDetailResponseSchema>

/**
 * 정지 (F4).
 *
 * 사유가 필수다 — 사유 없는 정지는 **해제할 근거도 없다.** 데이터베이스도 같은 것을
 * 지킨다 (`User_suspended_reason_check`).
 */
export const suspendUserRequestSchema = z.object({ reason: adminReasonSchema })

export type SuspendUserRequest = z.infer<typeof suspendUserRequestSchema>

/**
 * 적립금 수동 조정 (F5).
 *
 * **사유가 필수인 이유가 다른 곳과 다르다.** 여기서는 돈에 해당하는 값을 사람이
 * 임의로 바꾸므로, 사유는 감사의 대상이 아니라 **그 움직임의 유일한 근거**다 —
 * 주문도 클레임도 가리키지 않는 원장 줄이라 이유 칸이 비면 나중에 아무도 그것을
 * 설명할 수 없다.
 *
 * 0은 받지 않는다. 아무것도 안 하는 조정은 원장에 「왜 적혔는지 모르는 0원」을 남긴다.
 */
export const adjustPointsRequestSchema = z.object({
  amount: z.int().refine((value) => value !== 0, { message: '0은 조정이 아닙니다.' }),
  reason: adminReasonSchema,
})

export type AdjustPointsRequest = z.infer<typeof adjustPointsRequestSchema>

export const adjustPointsResponseSchema = z.object({
  balance: z.int().min(0),
  /** 실제로 움직인 몫. 잔액보다 큰 차감은 잔액까지만 간다. */
  applied: z.int(),
})

export type AdjustPointsResponse = z.infer<typeof adjustPointsResponseSchema>
