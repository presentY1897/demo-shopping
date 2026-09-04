import { Injectable } from '@nestjs/common'

import { SearchIndexerService } from '../search/search-indexer.service.js'
import { SearchOutboxService } from '../search/search-outbox.service.js'

/** What `/health` says about the indexing pipeline (TASK-0038 F7). */
export interface SearchIndexReport {
  readonly pending: number
  readonly lastRunAt: string | null
  readonly oldestPendingAt: string | null
}

const UNKNOWN: SearchIndexReport = { pending: 0, lastRunAt: null, oldestPendingAt: null }

/**
 * The queue's depth and the worker's last run.
 *
 * **It cannot fail the endpoint.** The same lesson as the demo sweep's reporter,
 * learned there: a health endpoint that 500s because a side field could not be
 * read is worse than the field being absent, because a 500 from `/health` reads
 * as "the process is gone". The `database` indicator reports a database outage;
 * this reports the pipeline, and "cannot say" is zero pending and no timestamps.
 */
@Injectable()
export class SearchIndexReporter {
  constructor(
    private readonly outbox: SearchOutboxService,
    private readonly indexer: SearchIndexerService,
  ) {}

  async report(): Promise<SearchIndexReport> {
    try {
      const backlog = await this.outbox.backlog()

      return {
        pending: backlog.pending,
        lastRunAt: this.indexer.lastRunAt()?.toISOString() ?? null,
        oldestPendingAt: backlog.oldestAt?.toISOString() ?? null,
      }
    } catch {
      return UNKNOWN
    }
  }
}
