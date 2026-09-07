import type {
  NotificationListResponse,
  ReadNotificationsRequest,
  ReadNotificationsResponse,
} from '@shopping/shared'
import { notificationListResponseSchema, readNotificationsResponseSchema } from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * 알림함이 부르는 두 자리 (TASK-0090).
 *
 * `lib/reviews/console-api.ts` · `lib/questions/console-api.ts` 와 같은 모양이고
 * 지켜지는 성질도 같다: **경로와 스키마가 한 번씩만 적힌다.** 화면은 응답의 모양을
 * 다시 선언하지 않는다 (게이트 C1).
 *
 * ## 사용자 id 를 아무 데도 싣지 않는다
 *
 * 두 라우트 다 `me/` 로 시작한다. 알림은 **자기 것뿐**이고, 요청이 주인을 말할 수
 * 있으면 언젠가 다른 주인이 실린다 — 그때 막는 것은 서버의 대조 하나뿐이다. 아예
 * 말할 수 없으면 그 대조가 필요 없다 (판매자 문의·리뷰의 쓰기가 같은 이유로 스토어
 * id 를 받지 않는다).
 *
 * ## 배지를 위한 라우트가 없다 (4.5)
 *
 * 목록이 미읽음 수를 **함께** 답한다. 그래서 상단바의 종은
 * `?unreadOnly=true&limit=5` 한 번으로 드롭다운의 다섯 줄과 배지의 숫자를 같이 얻고,
 * 알림함을 연 화면이 같은 것을 두 번 묻지 않는다.
 */

/** 알림 한 페이지와 **미읽음 수**. 질의 문자열은 `notification-console.ts` 가 만든다. */
export function fetchNotifications(
  search: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<NotificationListResponse> {
  return getApiClient().request({
    path: `/me/notifications${search}`,
    schema: notificationListResponseSchema,
    ...options,
  })
}

/**
 * 읽음 처리 (F4). 몸통은 `readRequest` 가 만든다 — **id 가 없으면 전부**다.
 *
 * 답으로 오는 것이 미읽음 수 하나인 것이 이 라우트의 좋은 점이다: 화면이 배지를 손으로
 * 깎지 않아도 되고, 다른 탭에서 읽은 것까지 같은 답에 반영되어 온다.
 */
export function markNotificationsRead(
  body: ReadNotificationsRequest,
): Promise<ReadNotificationsResponse> {
  return getApiClient().request({
    path: '/me/notifications/read',
    method: 'POST',
    body,
    schema: readNotificationsResponseSchema,
  })
}
