import { Inject, Injectable, Logger } from '@nestjs/common'
import type { HealthDependencyKey, HealthStatus } from '@shopping/shared'

import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { HealthIndicator } from './health-indicator.js'

/**
 * Shape of the probe result.
 *
 * `ok` is `unknown` on purpose: `pg` decides per column type whether a value
 * reaches JS as a number, a string or a bigint, and the check below is what
 * settles it — declaring `number` here would only be a claim nobody verified.
 */
interface ProbeRow {
  readonly ok: unknown
}

function isProbeAnswer(rows: unknown): boolean {
  if (!Array.isArray(rows) || rows.length !== 1) return false

  const row: unknown = rows[0]
  if (typeof row !== 'object' || row === null || !('ok' in row)) return false

  return Number(row.ok) === 1
}

class DeadlineError extends Error {
  constructor() {
    super('deadline exceeded')
    this.name = 'DeadlineError'
  }
}

/**
 * Bounds a promise that has no timeout of its own.
 *
 * `pg` bounds *acquiring* a connection, not running a query on one, so a server
 * that accepts the connection and then stops answering would hold the health
 * request open for as long as the caller is willing to wait. The timer is
 * cleared either way: an uncleared one keeps the event loop — and therefore the
 * process — alive.
 */
async function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined

  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new DeadlineError())
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

@Injectable()
export class DatabaseHealthIndicator implements HealthIndicator {
  readonly key: HealthDependencyKey = 'database'

  private readonly logger = new Logger(DatabaseHealthIndicator.name)

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Runs one trivial query and reports what came back.
   *
   * A round trip is the only honest check: `$connect()` having succeeded once at
   * boot says nothing about whether the pool can hand out a usable connection
   * now, which is exactly the failure this endpoint exists to surface.
   */
  async check(): Promise<HealthStatus> {
    try {
      const rows = await withDeadline(
        this.prisma.$queryRaw<ProbeRow[]>`SELECT 1 AS ok`,
        this.config.database.healthTimeoutMs,
      )

      return isProbeAnswer(rows) ? 'ok' : 'degraded'
    } catch (error) {
      this.logger.warn(`데이터베이스에 연결하지 못했습니다: ${reasonOf(error)}`)
      return 'down'
    }
  }
}

/** The exception class, not its message: the message can contain credentials. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError'
}
