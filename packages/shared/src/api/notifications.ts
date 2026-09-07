import { z } from 'zod'

/**
 * 알림 (TASK-0090).
 *
 * **실시간 푸시가 없다.** 30초 폴링으로 충분하다는 것이 4장의 판단이고, 그래서 이
 * 계약에 「전달됨」 같은 칸이 없다 — 읽었는가만 있다.
 */

/**
 * 무엇에 대한 알림인가.
 *
 * **받는 사람의 역할이 유형에 묻어 있다.** `SELLER_` 로 시작하는 것은 판매자가,
 * `ADMIN_` 은 관리자가 받는다 — 화면이 자기 것만 그리려고 역할을 다시 묻지 않아도
 * 된다.
 */
export const notificationTypes = [
  'ORDER_STATUS',
  'CLAIM_STATUS',
  'REVIEW_REPLY',
  'QUESTION_ANSWER',
  'RESTOCK',
  'NEW_PRODUCT',
  'SELLER_SETTLEMENT',
  'SELLER_ORDER',
  'SELLER_CLAIM',
  'ADMIN_SELLER_APPLICATION',
  'REPORT_HANDLED',
] as const

export type NotificationType = (typeof notificationTypes)[number]

export const notificationTypeSchema = z.enum(notificationTypes)

export const notificationSchema = z.object({
  id: z.uuid(),
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  /**
   * 눌렀을 때 갈 곳 — **앱 안의 경로**다 (`/mypage/orders/…`).
   *
   * 전체 주소가 아닌 이유는 알림을 읽는 앱이 셋이고 각자 자기 도메인에서 열기
   * 때문이다. 도메인을 여기 실으면 배포마다 달라지는 값이 데이터에 굳고, 도메인을
   * 옮기는 날 지난 알림이 전부 남의 사이트를 가리킨다.
   */
  link: z.string().nullable(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})

export type Notification = z.infer<typeof notificationSchema>

export const NOTIFICATION_LIST_DEFAULT_LIMIT = 20
export const NOTIFICATION_LIST_MAX_LIMIT = 50

export const notificationListQueryParamsSchema = z.object({
  /** `true` 면 안 읽은 것만. 헤더의 드롭다운이 쓴다. */
  unreadOnly: z.stringbool().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(NOTIFICATION_LIST_MAX_LIMIT).optional(),
})

export type NotificationListQueryParams = z.infer<typeof notificationListQueryParamsSchema>

export const notificationListResponseSchema = z.object({
  notifications: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
  /**
   * 안 읽은 알림의 수 (F3).
   *
   * **필터와 무관하다.** 목록과 함께 오는 이유는 헤더가 30초마다 이 하나를 위해
   * 다시 묻기 때문이다 — 배지만 따로 부르는 라우트를 두면 목록을 연 화면이 같은 것을
   * 두 번 묻는다.
   */
  unreadCount: z.int().min(0),
})

export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>

/**
 * `POST /api/v1/me/notifications/read` — 읽음 처리 (F4).
 *
 * **id 를 주지 않으면 전부**다. 「개별」과 「전체」를 두 라우트로 나누면 전체 읽음이
 * 화면에 보이는 것만 읽는지 정말 전부인지 이름이 말해 주지 않는다.
 */
export const readNotificationsRequestSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(NOTIFICATION_LIST_MAX_LIMIT).optional(),
})

export type ReadNotificationsRequest = z.infer<typeof readNotificationsRequestSchema>

export const readNotificationsResponseSchema = z.object({ unreadCount: z.int().min(0) })

export type ReadNotificationsResponse = z.infer<typeof readNotificationsResponseSchema>
