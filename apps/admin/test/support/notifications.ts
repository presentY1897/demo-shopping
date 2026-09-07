/**
 * 알림함 대역이 답하는 값들.
 *
 * **전부 계약 스키마를 지난다.** `@shopping/api-mocks` 의 `defineFixture` 가 모든
 * 응답에 하는 일과 같은 것이고, 같은 이유로 있다: 검사가 지어낸 모양은 서버가
 * 실제로 보내는 모양이 아닐 수 있고, 그러면 화면은 오지 않는 값을 그리는 코드로
 * 통과한다 (게이트 C2).
 *
 * **`packages/api-mocks` 에 msw 대역이 없다.** `/me/notifications` 라우트들은 그
 * 패키지에 아직 등록되어 있지 않고, 이 TASK 는 `apps/admin` 밖을 고치지 않는다.
 * 그래서 이 화면의 검사는 `lib/notifications/console-api` 를 대신 세운다 — 경로와
 * 스키마가 한 곳에 모여 있는 것이 그것을 가능하게 한다 (`support/settlements.ts` 와
 * 같은 사정).
 */

import type { Notification, NotificationListResponse } from '@shopping/shared'
import { notificationListResponseSchema, notificationSchema } from '@shopping/shared'

let serial = 0

/**
 * 알림 하나.
 *
 * 기본값은 관리자가 실제로 받는 것이다 — 입점 신청(`ADMIN_SELLER_APPLICATION`)은
 * `/sellers` 로 가는 링크를 달고 온다 (`seller.service.ts`).
 */
export function notification(overrides: Partial<Notification> = {}): Notification {
  serial += 1

  return notificationSchema.parse({
    id: `019596e0-0021-7000-8000-${String(serial).padStart(12, '0')}`,
    type: 'ADMIN_SELLER_APPLICATION',
    title: '입점 신청이 들어왔어요',
    body: '루미에르 의 신청을 검토해 주세요.',
    link: '/sellers',
    readAt: null,
    createdAt: '2026-09-06T01:00:00.000Z',
    ...overrides,
  })
}

export function notificationList(
  notifications: readonly Notification[],
  overrides: Partial<NotificationListResponse> = {},
): NotificationListResponse {
  return notificationListResponseSchema.parse({
    notifications,
    nextCursor: null,
    unreadCount: notifications.filter((row) => row.readAt === null).length,
    ...overrides,
  })
}
