import type {
  NotificationListQueryParams,
  NotificationListResponse,
  ReadNotificationsResponse,
} from '@shopping/shared'
import { notificationListResponseSchema, readNotificationsResponseSchema } from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 이 콘솔이 알림함에 대해 부르는 두 자리, 한 곳에.
 *
 * `lib/settlements/console-api.ts` 와 같은 모양이고 지켜지는 성질도 같다: **경로와
 * 스키마가 한 번씩만 적힌다.** 화면은 응답의 모양을 다시 선언하지 않으므로, 서버가
 * 필드 이름을 바꾸면 그 자리에서 파싱이 깨진다 — 화면이 조용히 `undefined` 를
 * 그리는 대신에 (게이트 C1).
 *
 * **배지를 위한 라우트가 따로 없다** (TASK-0090 4.5). 목록이 미읽음 수를 함께
 * 답하므로, 헤더는 `limit=5&unreadOnly=true` 한 번으로 목록과 배지를 같이 얻는다.
 */

/** `?unreadOnly=true&limit=5&cursor=…`, 아무것도 없으면 빈 문자열. */
export function notificationSearch(query: NotificationListQueryParams): string {
  const params = new URLSearchParams()

  if (query.unreadOnly !== undefined) params.set('unreadOnly', String(query.unreadOnly))
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.cursor !== undefined) params.set('cursor', query.cursor)

  const search = params.toString()

  return search === '' ? '' : `?${search}`
}

/** 한 페이지와 **미읽음 수**. 최신순이고 커서는 `id` 하나다 (F3). */
export function fetchNotifications(
  query: NotificationListQueryParams,
  options: { readonly signal?: AbortSignal } = {},
): Promise<NotificationListResponse> {
  return getApiClient().request({
    path: `/me/notifications${notificationSearch(query)}`,
    schema: notificationListResponseSchema,
    ...options,
  })
}

/**
 * 읽음 처리 (F4). **id 를 주지 않으면 전부**다.
 *
 * 「개별」과 「전체」를 두 함수로 나누지 않는 것은 계약이 나누지 않았기 때문이다
 * (`readNotificationsRequestSchema`) — 나누면 「전체 읽음」이 화면에 보이는 것만
 * 읽는지 정말 전부인지 이름이 말해 주지 않는다.
 */
export function readNotifications(ids?: readonly string[]): Promise<ReadNotificationsResponse> {
  return getApiClient().request({
    path: '/me/notifications/read',
    method: 'POST',
    body: ids === undefined ? {} : { ids: [...ids] },
    schema: readNotificationsResponseSchema,
  })
}
