import type { OnApplicationBootstrap } from '@nestjs/common'
import { Inject, Injectable, Logger } from '@nestjs/common'

import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'

/** Meilisearch's only unauthenticated route, and the one Render probes. */
const HEALTH_PATH = '/health'

/**
 * How long the warm-up request is allowed to stay open.
 *
 * Deliberately far above `MEILI_HEALTH_TIMEOUT_MS` (capped at 10s): this request
 * is not a health probe and nothing waits on its answer, so it can sit through a
 * full spin-up. Staying open is what turns it into a measurement — the log line
 * it produces is how long the search engine actually took to wake (F6).
 */
export const SEARCH_WARMUP_TIMEOUT_MS = 120_000

/**
 * Wakes the search engine once, as early in the API's life as possible.
 *
 * The search engine is a **separate** free service and sleeps on its own
 * schedule (TASK-0009 4장). Waking the API alone would leave the first search of
 * the visit facing its own ~90 second spin-up (TASK-0101 4.6).
 *
 * Render starts spinning a service up the moment a request reaches its router,
 * so a single request is the whole mechanism — the answer is irrelevant and is
 * never awaited by anything. `onApplicationBootstrap` rather than the first
 * `/health` call: the platform's own probe would get there eventually, but only
 * after the API is already serving, and relying on a probe we do not configure
 * makes the wake-up depend on a setting in another TASK's file.
 *
 * **Exactly one request per process.** No timer, no interval, no retry. A
 * repeating warm-up is "keep it awake", and the free plan's 750 shared instance
 * hours cannot pay for that (TASK-0009 R8, TASK-0101 4.8).
 */
@Injectable()
export class SearchWarmupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SearchWarmupService.name)

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  onApplicationBootstrap(): void {
    // Not awaited: boot must not wait on a service that may take a minute and a
    // half to answer. `void` makes that deliberate rather than a missing await.
    void this.wake()
  }

  /**
   * Sends the wake-up request and reports what happened. Never rejects — a
   * search engine that stays asleep must not take the API down with it.
   */
  async wake(): Promise<void> {
    // The API's own tests boot the module graph; a real socket to the search
    // host would be an outbound call from a test run (QUALITY-GATES 6장).
    if (this.config.nodeEnv === 'test') return

    const url = `${this.config.search.host.replace(/\/+$/, '')}${HEALTH_PATH}`
    const startedAt = performance.now()

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(SEARCH_WARMUP_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      })

      this.logger.log(
        `검색 엔진 웨이크업 요청 완료: HTTP ${response.status}, ${elapsedSeconds(startedAt)}초`,
      )
    } catch (error) {
      // Still counts as a wake-up: Render begins the spin-up when the request
      // reaches its router, and aborting our side does not cancel it.
      this.logger.warn(
        `검색 엔진 웨이크업 응답을 받지 못했습니다(기동은 시작됐을 수 있습니다): ` +
          `${reasonOf(error)}, ${elapsedSeconds(startedAt)}초`,
      )
    }
  }
}

function elapsedSeconds(startedAt: number): string {
  return ((performance.now() - startedAt) / 1000).toFixed(1)
}

/** The exception class, not its message: the message can contain the host. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError'
}
