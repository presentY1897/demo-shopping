import { Injectable } from '@nestjs/common'

import { DEMO_CLEANUP_LAST_RUN_KEY } from '../demo/demo-cleanup.js'
import { PrismaService } from '../prisma/prisma.service.js'

/**
 * When the demo cleanup sweep last finished, for `/health` (TASK-0025 F5).
 *
 * **Reads the row, not the service.** The sweep records its run in `AppMeta`, so
 * the answer survives a restart and is the same whichever instance is asked —
 * and `HealthModule` does not have to import `DemoModule` to publish it, which
 * would tie the endpoint that says whether the API is alive to the module that
 * hands out demo accounts.
 *
 * It is deliberately **not** a `HealthIndicator`: those answer a status that
 * feeds the overall verdict, and a sweep that has not run yet does not stop a
 * single request. The timestamp is published and the judgement is left to
 * whoever reads it.
 */
@Injectable()
export class DemoCleanupReporter {
  constructor(private readonly prisma: PrismaService) {}

  async lastRunAt(): Promise<string | null> {
    try {
      const row = await this.prisma.appMeta.findUnique({
        where: { key: DEMO_CLEANUP_LAST_RUN_KEY },
        select: { value: true },
      })

      if (row === null) return null

      const parsed = new Date(row.value)

      // A hand-edited row should not take the health endpoint down with it.
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
    } catch {
      /*
       * **The database being unreachable is not this field's news to report.**
       *
       * Found by `health.integration.spec.ts`: with the database down, this
       * query threw and took the whole endpoint to 500 — which is the one thing
       * `/health` must never do, because a 500 from it reads as "the process is
       * gone" and a load balancer stops routing to the last live instance. The
       * `database` indicator is what says the database is down, and it answers
       * `down` without throwing.
       *
       * So the timestamp is unknown, and unknown is `null` — the same answer as
       * "the sweep has not run yet". Both mean "do not trust this number", which
       * is all a reader can do with either.
       */
      return null
    }
  }
}
