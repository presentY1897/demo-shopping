import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import { Inject, Injectable, Logger } from '@nestjs/common'

import type { Clock } from '../common/clock.js'
import { CLOCK } from '../common/clock.js'
import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { ProductDocument } from './search-document.js'
import { ATTRIBUTE_FACET_PREFIX, isIndexable, toDocument } from './search-document.js'
import { productsIndexSettings } from './search-index-settings.js'
import type { SearchIndex } from './search-index.js'
import { SEARCH_INDEX } from './search-index.js'
import type { OutboxEvent } from './search-outbox.service.js'
import { SearchOutboxService } from './search-outbox.service.js'
import { readAttributeFacetKeys, readIndexablePage, readSources } from './search-source.js'

/** How often the queue is drained. The task asks for one second (F1: 2초 내). */
export const INDEXER_POLL_MS = 1_000

/** How many events one tick takes. */
export const INDEXER_BATCH = 200

/** How many listings one page of a full rebuild carries. */
export const REINDEX_PAGE = 200

/**
 * How many ticks between "is the index still there?" checks (F5b · R5).
 *
 * Once a minute, not once a second: the deployment this guards against is a
 * restart that emptied the engine (TASK-0009), which is a thing that happens
 * every few hours and not several times a second. Asking every tick would be
 * one HTTP call per second forever to learn nothing.
 */
export const POPULATION_CHECK_TICKS = 60

/**
 * Applies outbox events to the search index (TASK-0038 4장 · 5장).
 *
 * **Nothing waits on this.** It is started by Nest's lifecycle and drains a
 * queue; the product write that produced the event has already returned. That
 * is what makes F4 true — a dead search engine is a queue that stops moving,
 * not a save that fails.
 *
 * **Duplicates are collapsed inside a batch.** Ten edits to one listing in a
 * second are ten rows and one document, and rebuilding it ten times would be ten
 * writes to the engine for the same bytes. The last event for a product wins,
 * which is correct for both verbs: the document is built from the row as it is
 * *now*, and a `REMOVE` that came last is what the row now says.
 *
 * **The rebuild is locked** (F5c · R5). Two rebuilds at once would read the same
 * 800 rows twice and write them twice, and the trigger for one of them is
 * "somebody searched and the index was empty" — which is a thing several people
 * can do in the same second.
 */
@Injectable()
export class SearchIndexerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SearchIndexerService.name)
  private timer: NodeJS.Timeout | null = null
  private draining = false
  private rebuilding: Promise<number> | null = null
  private lastProcessedAt: Date | null = null
  private ticks = 0

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: SearchOutboxService,
    @Inject(SEARCH_INDEX) private readonly index: SearchIndex,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    /*
     * **The poller does not run under test, and the reason is measurement.**
     *
     * A timer that issues `SELECT … FROM "Product"` once a second inside the
     * application under test lands in whatever else is counting statements —
     * and two of this suite's performance specs count exactly that, to hold the
     * N+1 gate (A5). They started reporting fourteen statements where thirteen
     * were made, which reads as a regression in the endpoint rather than as a
     * background job doing its job.
     *
     * Nothing is lost: `tick()` is a `try`/`catch` around `drain()`, and
     * `drain()` is what every spec drives directly.
     */
    if (this.config.nodeEnv === 'test') return

    // Settings first, and never awaited here: a search engine that is asleep
    // must not hold the API's boot open (TASK-0101 4.6 makes the same call for
    // the warm-up).
    // Settings, then "is there anything in there?". A deployment that has just
    // restarted has an empty engine and a full database, and nobody should have
    // to search once to notice.
    void this.configure().then(() => this.ensurePopulated())

    this.timer = setInterval(() => void this.tick(), INDEXER_POLL_MS)
    this.timer.unref()
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /** When the worker last applied something. `/health` reads it (F7). */
  lastRunAt(): Date | null {
    return this.lastProcessedAt
  }

  /** Applies the index settings, including the facets that exist today. */
  async configure(): Promise<void> {
    try {
      const keys = await readAttributeFacetKeys(this.prisma)

      await this.index.configure(
        productsIndexSettings(keys.map((key) => `${ATTRIBUTE_FACET_PREFIX}${key}`)),
      )
    } catch (error) {
      // A cold engine is the normal state of a fresh deployment. The next tick
      // and the next boot both try again.
      this.logger.warn(`검색 인덱스 설정을 적용하지 못했습니다: ${String(error)}`)
    }
  }

  /**
   * One pass of the queue.
   *
   * Public so a spec can drive it: waiting a second per assertion would make the
   * suite slower than the thing it tests.
   */
  async drain(limit: number = INDEXER_BATCH): Promise<number> {
    const now = this.clock.now()
    const events = await this.outbox.due(now, limit)

    if (events.length === 0) return 0

    const latest = collapse(events)

    try {
      const sources = await readSources(this.prisma, [...latest.keys()])
      const byId = new Map(sources.map((source) => [source.id, source]))
      const upserts: ProductDocument[] = []
      const removals: string[] = []

      for (const [productId, event] of latest) {
        const source = byId.get(productId)

        // Gone from the database, or no longer `ACTIVE`: either way the document
        // must not be findable, and both arrive here as the same instruction.
        if (event.kind === 'REMOVE' || source === undefined || !isIndexable(source)) {
          removals.push(productId)
          continue
        }

        upserts.push(toDocument(source))
      }

      await this.index.upsert(upserts)
      await this.index.remove(removals)
      await this.outbox.complete(events.map((event) => event.id))

      this.lastProcessedAt = now

      return events.length
    } catch (error) {
      await this.outbox.fail(events, now, String(error))
      this.logger.warn(`인덱싱에 실패했습니다 — ${String(events.length)}건 재시도 예약`)

      return 0
    }
  }

  /**
   * Rebuilds the whole index (F5).
   *
   * Answers how many documents it wrote. Concurrent callers get the **same**
   * promise rather than a second rebuild — which is what F5c asks for and what
   * stops the empty-index trigger from firing once per searcher.
   */
  async reindexAll(): Promise<number> {
    this.rebuilding ??= this.rebuild().finally(() => {
      this.rebuilding = null
    })

    return this.rebuilding
  }

  /** Whether a rebuild is running right now. */
  get isRebuilding(): boolean {
    return this.rebuilding !== null
  }

  /**
   * Rebuilds only when the index is genuinely empty (F5b · R5).
   *
   * `size()` answers `null` when the engine cannot be reached, and `null` is
   * deliberately **not** treated as empty: a rebuild fired by a network hiccup
   * would read the whole catalogue to write it back over itself.
   */
  async ensurePopulated(): Promise<boolean> {
    if (this.rebuilding !== null) return false

    const size = await this.index.size()

    if (size === null || size > 0) return false

    const written = await this.reindexAll()

    if (written > 0) this.logger.log(`인덱스가 비어 있어 ${String(written)}건을 다시 채웠습니다.`)

    return written > 0
  }

  private async tick(): Promise<void> {
    if (this.draining) return

    this.draining = true

    try {
      await this.drain()

      this.ticks += 1

      if (this.ticks % POPULATION_CHECK_TICKS === 0) await this.ensurePopulated()
    } catch (error) {
      this.logger.error('인덱싱 주기 실행에 실패했습니다.', error)
    } finally {
      this.draining = false
    }
  }

  private async rebuild(): Promise<number> {
    await this.configure()

    let after: string | null = null
    let written = 0

    for (;;) {
      const page: readonly ProductDocument[] = (
        await readIndexablePage(this.prisma, after, REINDEX_PAGE)
      ).map(toDocument)

      if (page.length === 0) break

      await this.index.upsert(page)

      written += page.length
      after = page[page.length - 1]?.id ?? null

      if (page.length < REINDEX_PAGE) break
    }

    this.lastProcessedAt = this.clock.now()

    return written
  }
}

/**
 * The last event per product, in the order they were queued.
 *
 * A `Map` keyed by product id: later writes overwrite earlier ones, so what is
 * left is one instruction per document — and the instruction is the newest,
 * which is the only one that describes the row as it is now.
 */
function collapse(events: readonly OutboxEvent[]): ReadonlyMap<string, OutboxEvent> {
  const latest = new Map<string, OutboxEvent>()

  for (const event of events) latest.set(event.productId, event)

  return latest
}
