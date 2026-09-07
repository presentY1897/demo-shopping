import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import type { NotificationListResponse, ReadNotificationsResponse } from '@shopping/shared'
import { notificationListQueryParamsSchema, readNotificationsRequestSchema } from '@shopping/shared'

import { Principal } from '../auth/principal.decorator.js'
import { RequirePermission } from '../auth/require-permission.decorator.js'
import type { RequestPrincipal } from '../auth/request-principal.js'
import { parseInput } from '../common/parse-input.js'
import { NotificationService } from './notification.service.js'

/**
 * 알림함 (TASK-0090).
 *
 * ## 라우트가 둘뿐이다
 *
 * 배지를 위한 라우트를 따로 두지 않는다 — 목록이 미읽음 수를 함께 답하므로, 목록을
 * 연 화면이 같은 것을 두 번 묻지 않는다. 헤더는 `limit=5&unreadOnly=true` 로 부르고
 * 그 답에서 배지도 함께 얻는다.
 *
 * ## 퍼미션이 하나다
 *
 * 알림은 **자기 것뿐**이고, 이 문들은 사용자 id 를 받지 않는다. 판매자·관리자 알림도
 * 같은 문으로 온다 — 유형에 역할이 묻어 있어서 화면이 자기 것만 그린다.
 */
@Controller({ version: '1' })
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  /** 알림함과 미읽음 수 (F3). */
  @Get('me/notifications')
  @RequirePermission('notification.read')
  list(
    @Principal() principal: RequestPrincipal,
    @Query() query: unknown,
  ): Promise<NotificationListResponse> {
    return this.notifications.list(
      principal.userId,
      parseInput(notificationListQueryParamsSchema, query),
    )
  }

  /** 읽음 처리 (F4). **id 를 주지 않으면 전부**다. */
  @Post('me/notifications/read')
  @RequirePermission('notification.read')
  read(
    @Principal() principal: RequestPrincipal,
    @Body() body: unknown,
  ): Promise<ReadNotificationsResponse> {
    return this.notifications.read(
      principal.userId,
      parseInput(readNotificationsRequestSchema, body),
    )
  }
}
