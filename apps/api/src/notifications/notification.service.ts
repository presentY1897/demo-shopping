import { Inject, Injectable, Logger } from '@nestjs/common'
import type { NotificationType, Prisma } from '@prisma/client'
import type {
  NotificationListQueryParams,
  NotificationListResponse,
  ReadNotificationsRequest,
  ReadNotificationsResponse,
} from '@shopping/shared'
import { NOTIFICATION_LIST_DEFAULT_LIMIT } from '@shopping/shared'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { retentionCutoff, shouldNotify } from './notification-rules.js'

/** 보낼 알림 하나. */
export interface NotificationDraft {
  readonly userId: string
  readonly type: NotificationType
  readonly title: string
  readonly body: string
  /** 앱 안의 경로. 없으면 누를 곳이 없는 알림이다. */
  readonly link?: string
}

/**
 * 알림 (TASK-0090).
 *
 * ## 이 서비스는 **던지지 않는다**
 *
 * 알림 생성이 원래 작업을 지연시키거나 실패시키면 안 된다 (F6) — 주문 상태 변경
 * 트랜잭션에 알림이 끼면 실패 지점이 늘어나고, 그 실패는 「배송 처리가 안 됐다」로
 * 나타난다. 알림을 못 받는 것과 물건이 안 가는 것은 다른 일이다.
 *
 * 그래서 {@link send} 는 예외를 삼키고 로그만 남기며, 부르는 쪽은 `await` 하지 않는다.
 *
 * ## 수신 설정을 **보내기 전에** 본다
 *
 * 만들어 두고 화면에서 거르는 길도 있었지만, 그러면 끈 사람의 배지가 올라간다 —
 * 배지는 「할 일이 몇 개」이고 읽지 않을 알림은 할 일이 아니다.
 */
@Injectable()
export class NotificationService {
  private readonly log = new Logger(NotificationService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * 한 사람에게 하나 (F1 · F5 · F6).
   *
   * **기다리지 않아도 되게** 만들어져 있다 — 부르는 쪽이 `void` 로 던져 놓고 자기
   * 일을 끝낸다.
   */
  async send(draft: NotificationDraft): Promise<void> {
    await this.sendMany([draft])
  }

  /**
   * 여러 사람에게 같은 것을 (TASK-0089 F5).
   *
   * **한 문장으로 넣는다.** 팔로워가 100명이든 10,000명이든 문장 수가 같아야 상품
   * 등록이 팔로워 수만큼 느려지지 않는다 — 그것이 저쪽 F5 가 재는 것이다.
   *
   * 수신 설정도 한 번에 읽는다. 사람마다 물으면 그 조회가 팔로워 수만큼 늘어난다.
   */
  async sendMany(drafts: readonly NotificationDraft[]): Promise<void> {
    if (drafts.length === 0) return

    try {
      const userIds = [...new Set(drafts.map((draft) => draft.userId))]
      const preferences = await this.prisma.userPreference.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, notifyOrder: true, notifyClaim: true },
      })
      const byUser = new Map(preferences.map((row) => [row.userId, row]))
      const now = this.clock.now()
      const going = drafts.filter((draft) =>
        shouldNotify(draft.type, byUser.get(draft.userId) ?? null),
      )

      if (going.length === 0) return

      await this.prisma.notification.createMany({
        data: going.map((draft) => ({
          userId: draft.userId,
          type: draft.type,
          title: draft.title,
          body: draft.body,
          link: draft.link ?? null,
          createdAt: now,
        })),
      })
    } catch (error) {
      // **원래 작업은 이미 끝났다.** 여기서 던지면 그 작업이 실패한 것처럼 보인다.
      this.log.warn(`알림을 만들지 못했습니다: ${drafts.length}건`, error)
    }
  }

  /** 알림함 (F3). 배지가 목록과 **함께** 온다. */
  async list(
    userId: string,
    params: NotificationListQueryParams,
  ): Promise<NotificationListResponse> {
    const limit = params.limit ?? NOTIFICATION_LIST_DEFAULT_LIMIT
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(params.unreadOnly === true ? { readAt: null } : {}),
      ...(params.cursor === undefined ? {} : { id: { lt: params.cursor } }),
    }
    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        // 정렬 축이 `id` 인 것은 UUIDv7 이라 시간순이기 때문이다.
        orderBy: { id: 'desc' },
        take: limit + 1,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          link: true,
          readAt: true,
          createdAt: true,
        },
      }),
      this.unread(userId),
    ])
    const page = rows.slice(0, limit)

    return {
      notifications: page.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        link: row.link,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      unreadCount,
    }
  }

  /**
   * 읽음 처리 (F4). **id 를 주지 않으면 전부**다.
   *
   * 이미 읽은 것은 다시 읽지 않는다 — 조건에 `readAt: null` 이 있어서, 두 번 눌러도
   * 처음 읽은 시각이 그대로 남는다.
   */
  async read(
    userId: string,
    request: ReadNotificationsRequest,
  ): Promise<ReadNotificationsResponse> {
    await this.prisma.notification.updateMany({
      where: {
        userId,
        readAt: null,
        ...(request.ids === undefined ? {} : { id: { in: [...request.ids] } }),
      },
      data: { readAt: this.clock.now() },
    })

    return { unreadCount: await this.unread(userId) }
  }

  /**
   * 오래된 알림을 지운다 (정리 배치).
   *
   * **읽지 않은 것도 지운다.** 90일을 안 읽었다는 것은 그 알림이 할 일을 이미
   * 놓쳤다는 뜻이고, 배지에 영영 남는 숫자는 배지를 무의미하게 만든다.
   */
  async prune(): Promise<number> {
    const removed = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: retentionCutoff(this.clock.now()) } },
    })

    return removed.count
  }

  private async unread(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } })
  }
}
