import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Inject, Injectable, Logger } from '@nestjs/common'

import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { NotificationService } from './notification.service.js'

/**
 * 주기 — 1분.
 *
 * 재입고 알림은 **분 단위면 충분하다.** 상품이 다시 들어온 순간과 알림 사이의 몇 십
 * 초가 사람의 행동을 바꾸지 않고, 짧게 잡을수록 이 조회가 자주 돈다.
 */
const RESTOCK_INTERVAL_MS = 60_000

/** 한 주기가 보내는 알림의 상한. 나머지는 다음 주기가 이어서 집는다. */
const RESTOCK_BATCH_LIMIT = 500

/**
 * 찜한 상품이 다시 들어왔다고 알린다 (TASK-0086 F4 · TASK-0090).
 *
 * ## 왜 상품 수정 경로에 끼워 넣지 않았는가
 *
 * 재고가 0에서 올라오는 자리는 상품 수정 트랜잭션의 **깊은 안쪽**이다. 거기에 알림을
 * 끼우면 판매자의 저장이 찜한 사람 수에 따라 느려지고, 그 트랜잭션의 실패 지점이
 * 하나 늘어난다 — 「재고를 고쳤는데 저장이 안 됐다」는 알림을 못 받는 것보다 훨씬
 * 나쁘다 (TASK-0090 F6 이 말하는 것과 같은 판단이다).
 *
 * 대신 **밖에서 본다.** 「알림을 기다리는 찜」과 「지금 팔 수 있는 상품」이 만나는
 * 줄을 주기적으로 찾는다. 대가는 최대 1분의 지연이고, 재입고 알림에서 그 지연은
 * 사람의 행동을 바꾸지 않는다.
 *
 * ## 보낸 뒤에는 신청이 꺼진다
 *
 * 한 번 알린 재입고를 다시 알릴 이유가 없고, 또 품절이 되면 사람이 다시 신청한다.
 * 끄는 것과 보내는 것이 **한 트랜잭션**인 이유는 그 사이에 주기가 한 번 더 돌면 같은
 * 사람에게 같은 알림이 두 번 가기 때문이다.
 */
@Injectable()
export class RestockNotifier implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RestockNotifier.name)
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** 주기를 건다 — **검사에서는 걸지 않는다** (`order-confirm.service.ts` 와 같은 이유). */
  onModuleInit(): void {
    if (this.config.nodeEnv === 'test') return

    this.timer = setInterval(() => void this.tick(), RESTOCK_INTERVAL_MS)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    if (this.running) return

    this.running = true

    try {
      await this.sweep()
    } catch (error) {
      this.log.error('재입고 알림에 실패했습니다.', error)
    } finally {
      this.running = false
    }
  }

  /**
   * 한 주기. 수동 실행은 없다 — 늦어도 1분이면 다음 주기가 온다.
   *
   * **고르는 것과 끄는 것이 한 트랜잭션이다.** 그 사이에 주기가 한 번 더 돌면 같은
   * 사람에게 같은 알림이 두 번 간다.
   */
  async sweep(): Promise<number> {
    const ready = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ userId: string; productId: string; name: string }[]>`
        SELECT w."userId"::text AS "userId", p."id"::text AS "productId", p."name" AS "name"
          FROM "Wishlist" w
          JOIN "Product" p ON p."id" = w."productId"
         WHERE w."notifyRestock"
           AND p."status" = 'ACTIVE'
           AND p."minPrice" IS NOT NULL
         LIMIT ${RESTOCK_BATCH_LIMIT}
           FOR UPDATE OF w SKIP LOCKED`

      if (rows.length === 0) return []

      await tx.wishlist.updateMany({
        where: {
          OR: rows.map((row) => ({ userId: row.userId, productId: row.productId })),
        },
        data: { notifyRestock: false },
      })

      return rows
    })

    await this.notifications.sendMany(
      ready.map((row) => ({
        userId: row.userId,
        type: 'RESTOCK' as const,
        title: '찜한 상품이 다시 들어왔어요',
        body: row.name,
        link: `/products/${row.productId}`,
      })),
    )

    return ready.length
  }
}
