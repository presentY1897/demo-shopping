import type {
  ApiCallOptions,
  NotificationListResponse,
  ReadNotificationsRequest,
  ReadNotificationsResponse,
} from '@shopping/shared'
import { notificationListResponseSchema, readNotificationsResponseSchema } from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 알림함이 부르는 라우트 둘 (TASK-0090).
 *
 * **응답 타입을 다시 적지 않는다** (게이트 C1). 둘 다 계약 스키마로 파싱한다.
 *
 * ## 배지만 부르는 문이 없다
 *
 * 미읽음 수는 목록과 **함께** 온다(`notificationListResponseSchema.unreadCount`).
 * 그래서 헤더는 30초마다 `limit=5&unreadOnly=true` 로 이 하나를 부르고, 그 한 번의
 * 답이 배지의 숫자이자 드롭다운의 내용이다 — 배지를 따로 부르는 라우트가 있었다면
 * 드롭다운을 연 화면이 같은 것을 두 번 물었을 것이다.
 */

export function fetchNotifications(
  {
    cursor,
    limit,
    unreadOnly,
  }: {
    readonly cursor: string | null
    readonly limit: number
    readonly unreadOnly: boolean
  },
  options?: ApiCallOptions,
): Promise<NotificationListResponse> {
  const search = new URLSearchParams({ limit: String(limit) })

  // `?unreadOnly=` 는 「전부」가 아니라 빈 문자열이고, 계약의 `z.stringbool()` 은
  // 그것을 400 으로 답한다. 꺼져 있으면 아예 싣지 않는다.
  if (unreadOnly) search.set('unreadOnly', 'true')
  if (cursor !== null) search.set('cursor', cursor)

  return getApiClient().request({
    path: `/me/notifications?${search.toString()}`,
    schema: notificationListResponseSchema,
    ...options,
  })
}

/**
 * 읽음 처리 (F4). **id 를 주지 않으면 전부**다.
 *
 * 「개별」과 「전체」를 두 함수로 나누지 않는 이유는 계약이 하나이기 때문이다 —
 * 나누면 「전체 읽음」이 화면에 보이는 것만 읽는지 정말 전부인지 이름이 말해 주지
 * 않는다 (`readNotificationsRequestSchema` 의 머리말).
 *
 * 답이 **갱신된 미읽음 수**라 화면이 직접 빼지 않는다. 빼면 다른 탭에서 읽은 것이
 * 반영되지 않고, 배지와 목록이 서로 다른 말을 한다.
 */
export function readNotifications(
  body: ReadNotificationsRequest,
  options?: ApiCallOptions,
): Promise<ReadNotificationsResponse> {
  return getApiClient().request({
    path: '/me/notifications/read',
    method: 'POST',
    body,
    schema: readNotificationsResponseSchema,
    ...options,
  })
}
