import { Module } from '@nestjs/common'

import { MeilisearchIndex, SEARCH_INDEX } from './search-index.js'
import { SearchIndexerService } from './search-indexer.service.js'
import { SearchOutboxService } from './search-outbox.service.js'
import { SearchController } from './search.controller.js'
import { SearchService } from './search.service.js'

/**
 * The index and the pipeline that fills it (TASK-0038).
 *
 * `SearchIndexerService` has no consumer: Nest calls its
 * `OnApplicationBootstrap` and the timer does the rest, the same shape
 * `SearchWarmupService` uses. What is exported is the outbox — the seam every
 * product write reaches for — and the indexer, which the health endpoint and the
 * reindex command ask questions of.
 */
@Module({
  controllers: [SearchController],
  providers: [
    SearchService,
    SearchOutboxService,
    SearchIndexerService,
    { provide: SEARCH_INDEX, useClass: MeilisearchIndex },
  ],
  exports: [SearchOutboxService, SearchIndexerService, SearchService, SEARCH_INDEX],
})
export class SearchModule {}
