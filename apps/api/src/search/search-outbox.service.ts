import { Inject, Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import { PrismaService } from '../prisma/prisma.service.js'

type Tx = Prisma.TransactionClient

/** How long a failed event waits before the worker tries again. */
const BACKOFF_MS = [1_000, 5_000, 30_000, 120_000, 600_000] as const

/**
 * How many failures before the worker stops retrying on the fast schedule.
 *
 * Not a dead-letter: the event stays in the queue and keeps being retried every
 * ten minutes, because the usual cause is the search engine being down and that
 * is a condition that ends. What the cap does is stop a single poisoned event
 * from being tried a thousand times an hour while it does.
 */
export const OUTBOX_MAX_FAST_ATTEMPTS = BACKOFF_MS.length

export interface OutboxEvent {
  readonly id: bigint
  readonly productId: string
  readonly kind: 'UPSERT' | 'REMOVE'
  readonly attempts: number
}

/**
 * The queue between a product write and the search index (TASK-0038 4장).
 *
 * **`publish` takes the caller's transaction.** That is the whole mechanism: the
 * event exists exactly when the product change does. A commit that rolls back
 * takes its events with it, so there is no ghost document; and the engine is
 * never touched inside the transaction, so an outage cannot fail a save (F4).
 */
@Injectable()
export class SearchOutboxService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Records that a listing's document is stale. Call inside the write's transaction.
   *
   * **The timestamps come from the injected clock, not from `DEFAULT now()`.**
   * The worker asks the same clock whether an event is due, and a row written
   * with the *database's* idea of now would be compared against the
   * *application's* — which agree in production and diverge under a fixed test
   * clock, so the queue would silently never be due. `clock-injection.spec.ts`
   * names this exact trap in its header.
   */
  async publish(tx: Tx, productId: string, kind: 'UPSERT' | 'REMOVE'): Promise<void> {
    const now = this.clock.now()

    await tx.searchOutbox.create({
      data: { productId, kind, createdAt: now, nextAttemptAt: now },
    })
  }

  /** The events that are due, oldest first. */
  async due(now: Date, limit: number): Promise<readonly OutboxEvent[]> {
    const rows = await this.prisma.searchOutbox.findMany({
      where: { nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
      select: { id: true, productId: true, kind: true, attempts: true },
    })

    return rows
  }

  /** Removes the events that were applied. The index is the record now. */
  async complete(ids: readonly bigint[]): Promise<void> {
    if (ids.length === 0) return

    await this.prisma.searchOutbox.deleteMany({ where: { id: { in: [...ids] } } })
  }

  /**
   * Pushes failed events out and records why.
   *
   * The backoff is per event rather than per worker: one listing whose document
   * cannot be built must not slow down the queue behind it.
   */
  async fail(events: readonly OutboxEvent[], now: Date, reason: string): Promise<void> {
    for (const event of events) {
      const step = Math.min(event.attempts, BACKOFF_MS.length - 1)
      const wait = BACKOFF_MS[step] ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 600_000

      await this.prisma.searchOutbox.update({
        where: { id: event.id },
        data: {
          attempts: { increment: 1 },
          nextAttemptAt: new Date(now.getTime() + wait),
          lastError: reason.slice(0, 500),
        },
      })
    }
  }

  /** What `/health` reports: how many are waiting and how old the oldest is. */
  async backlog(): Promise<{ readonly pending: number; readonly oldestAt: Date | null }> {
    const [pending, oldest] = await Promise.all([
      this.prisma.searchOutbox.count(),
      this.prisma.searchOutbox.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ])

    return { pending, oldestAt: oldest?.createdAt ?? null }
  }
}
