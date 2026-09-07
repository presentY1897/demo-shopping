/**
 * The answers TASK-0090's two routes give, built through their contracts.
 *
 * `defineFixture` parses at module load, so a fixture that drifts from
 * `@shopping/shared` takes down every spec that imports it (gate C2).
 *
 * These live here rather than in `@shopping/api-mocks` only because this branch
 * does not own `packages/` — see `support/api-stub.ts`.
 */

import { defineFixture } from '@shopping/api-mocks'
import type { Notification, NotificationListResponse } from '@shopping/shared'
import { notificationListResponseSchema, readNotificationsResponseSchema } from '@shopping/shared'
import type { ReadNotificationsResponse } from '@shopping/shared'

/**
 * 새 주문 — 안 읽음, 링크 있음.
 *
 * 판매자가 이 화면에 오는 이유의 대표다. `link` 가 `/orders/…` 인 것은 알림이 **앱
 * 안의 경로**를 싣기 때문이고(4.7), 그 경로는 이 콘솔에 실제로 있는 라우트다.
 */
const unreadOrder = {
  body: '주문 20260904-000123 · 128,000원',
  createdAt: '2026-09-04T02:00:00.000Z',
  id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f9001',
  link: '/orders/019596d0-1f1c-7c2e-9a0e-4a5a3a2fa001',
  readAt: null,
  title: '새 주문이 들어왔어요',
  type: 'SELLER_ORDER',
} satisfies Notification

/** 정산 — 안 읽음. 두 번째 유형이 있어야 유형 이름이 줄마다 다르다는 것이 드러난다. */
const unreadSettlement = {
  body: '1,240,000원',
  createdAt: '2026-09-03T02:00:00.000Z',
  id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f9002',
  link: '/settlements/019596d0-1f1c-7c2e-9a0e-4a5a3a2fb001',
  readAt: null,
  title: '정산금이 지급됐어요',
  type: 'SELLER_SETTLEMENT',
} satisfies Notification

/**
 * 신고 처리 — **링크가 없는 진짜 알림**이다.
 *
 * `report.service.ts` 가 `link` 없이 보낸다. 계약이 `nullable` 인 이유가 그것이고,
 * 갈 곳이 없는 알림에 「보러 가기」를 그리면 아무 데도 가지 않는 링크가 된다.
 */
const readReport = {
  body: '신고해 주신 내용을 확인했습니다.',
  createdAt: '2026-09-02T02:00:00.000Z',
  id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f9003',
  link: null,
  readAt: '2026-09-02T03:00:00.000Z',
  title: '신고가 처리됐어요',
  type: 'REPORT_HANDLED',
} satisfies Notification

export const UNREAD_ORDER_ID = unreadOrder.id

export const UNREAD_ORDER_TITLE = unreadOrder.title

export const UNREAD_ORDER_LINK = unreadOrder.link

export const UNREAD_SETTLEMENT_TITLE = unreadSettlement.title

export const READ_REPORT_TITLE = readReport.title

/**
 * 알림함의 첫 페이지 — 읽은 것과 안 읽은 것이 섞여 있고 `nextCursor` 가 있다.
 *
 * **미읽음 수가 이 페이지의 미읽음 줄 수(2)가 아니다.** 계약이 필터와 무관한 전체
 * 수를 보낸다(4.5). 「보이는 줄로 세기」로 되돌아가는 회귀는 이 차이로만 드러난다.
 */
export const notificationsPage1: NotificationListResponse = defineFixture(
  notificationListResponseSchema,
  {
    nextCursor: 'cursor-page-2',
    notifications: [unreadOrder, unreadSettlement, readReport],
    unreadCount: 6,
  },
)

/** 마지막 페이지. */
export const notificationsPage2: NotificationListResponse = defineFixture(
  notificationListResponseSchema,
  {
    nextCursor: null,
    notifications: [{ ...readReport, id: '019596d0-1f1c-7c2e-9a0e-4a5a3a2f9004' }],
    unreadCount: 6,
  },
)

/** 헤더가 받는 답: 안 읽은 것만, 다섯 줄 한도. */
export const unreadNotifications: NotificationListResponse = defineFixture(
  notificationListResponseSchema,
  { nextCursor: null, notifications: [unreadOrder, unreadSettlement], unreadCount: 6 },
)

/** 모두 읽은 뒤. 배지가 사라지고 드롭다운이 「할 일이 없다」를 말한다. */
export const notificationsAllRead: NotificationListResponse = defineFixture(
  notificationListResponseSchema,
  { nextCursor: null, notifications: [], unreadCount: 0 },
)

export const notificationsEmpty: NotificationListResponse = defineFixture(
  notificationListResponseSchema,
  { nextCursor: null, notifications: [], unreadCount: 0 },
)

/** `POST /me/notifications/read` 의 답 — 미읽음 수 하나뿐이다. */
export const readAcknowledged: ReadNotificationsResponse = defineFixture(
  readNotificationsResponseSchema,
  { unreadCount: 0 },
)
