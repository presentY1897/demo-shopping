import { z } from 'zod'

/**
 * 신고 (TASK-0091).
 *
 * **자동 임시 숨김이 이 기능의 요점이다.** 관리자가 즉시 대응할 수 없는 시간대에
 * 악성 콘텐츠가 노출된 채 남는 것을 막는다 — 임계치를 넘으면 일단 가리고, 반려하면
 * 복구된다.
 */

export const reportTargetTypes = ['REVIEW', 'QUESTION', 'ANSWER', 'PRODUCT'] as const

export type ReportTargetType = (typeof reportTargetTypes)[number]

export const reportTargetTypeSchema = z.enum(reportTargetTypes)

/**
 * 왜 신고했나.
 *
 * 목록을 고정하는 이유는 **자유 입력이 분류를 불가능하게 만들기** 때문이다. 관리자가
 * 「욕설 신고가 이번 주에 몇 건」을 셀 수 없으면 신고 처리는 한 건씩 읽는 일이 된다.
 */
export const reportReasons = ['ABUSE', 'SPAM', 'FALSE_INFO', 'PRIVACY', 'OTHER'] as const

export type ReportReason = (typeof reportReasons)[number]

export const reportReasonSchema = z.enum(reportReasons)

export const reportStatuses = ['PENDING', 'HIDDEN', 'REMOVED', 'REJECTED'] as const

export type ReportStatus = (typeof reportStatuses)[number]

export const reportStatusSchema = z.enum(reportStatuses)

export const REPORT_DETAIL_MAX = 500

/**
 * `POST /api/v1/reports` — 신고한다 (F1 · F2).
 *
 * **「기타」에는 설명이 필수다.** 사유 목록을 고정한 것은 분류를 위해서인데,
 * 분류되지 않는 신고에 설명까지 없으면 관리자가 판단할 근거가 하나도 없다.
 */
export const createReportRequestSchema = z
  .object({
    targetType: reportTargetTypeSchema,
    targetId: z.uuid(),
    reason: reportReasonSchema,
    detail: z.string().trim().max(REPORT_DETAIL_MAX).optional(),
  })
  .refine(
    (input) => input.reason !== 'OTHER' || (input.detail ?? '').length > 0,
    '기타 사유를 고르면 내용을 적어 주세요.',
  )

export type CreateReportRequest = z.infer<typeof createReportRequestSchema>

/** 신고 한 벌. 관리자 목록이 읽는다. */
export const reportSchema = z.object({
  id: z.uuid(),
  targetType: reportTargetTypeSchema,
  targetId: z.uuid(),
  reason: reportReasonSchema,
  detail: z.string().nullable(),
  status: reportStatusSchema,
  /**
   * 이 대상이 **지금까지 몇 번** 신고됐나.
   *
   * 한 건씩 읽는 관리자에게 필요한 것은 「이 신고가 몇 번째인가」다 — 다섯 번째
   * 신고와 첫 신고는 같은 내용이어도 다른 무게를 갖는다.
   */
  targetReportCount: z.int().min(1),
  /** 대상이 지금 가려져 있는가. 자동 임시 숨김도 여기에 나타난다. */
  targetHidden: z.boolean(),
  /** 신고된 내용 — 관리자가 대상 화면으로 가지 않고도 판단할 수 있게. */
  targetExcerpt: z.string().nullable(),
  handledNote: z.string().nullable(),
  handledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})

export type Report = z.infer<typeof reportSchema>

export const reportResponseSchema = z.object({ report: reportSchema })

export type ReportResponse = z.infer<typeof reportResponseSchema>

export const REPORT_LIST_DEFAULT_LIMIT = 20
export const REPORT_LIST_MAX_LIMIT = 100

export const reportListQueryParamsSchema = z.object({
  status: z
    .string()
    .transform((value) => value.split(','))
    .pipe(z.array(reportStatusSchema).min(1))
    .optional(),
  targetType: reportTargetTypeSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(REPORT_LIST_MAX_LIMIT).optional(),
})

export type ReportListQueryParams = z.infer<typeof reportListQueryParamsSchema>

export const reportListResponseSchema = z.object({
  reports: z.array(reportSchema),
  nextCursor: z.string().nullable(),
  /** 처리 대기 건수. **필터와 무관하다** — 「할 일이 몇 개」다. */
  pendingCount: z.int().min(0),
})

export type ReportListResponse = z.infer<typeof reportListResponseSchema>

/**
 * `POST /api/v1/reports/:id/handle` — 처리한다 (F4 · F5 · F6).
 *
 * **반려도 처리다.** 「아무 일도 없었다」가 아니라 「보고 아니라고 판단했다」이고,
 * 그 판단에도 사람과 시각과 사유가 있다 — 그리고 자동 임시 숨김이 **풀린다**.
 */
export const handleReportRequestSchema = z.object({
  outcome: z.enum(['HIDDEN', 'REMOVED', 'REJECTED']),
  /** 신고자에게 가는 알림이 이 문장을 싣는다. */
  note: z.string().trim().min(1).max(REPORT_DETAIL_MAX),
})

export type HandleReportRequest = z.infer<typeof handleReportRequestSchema>
