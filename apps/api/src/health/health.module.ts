import { Module } from '@nestjs/common'

import { SearchModule } from '../search/search.module.js'

import { DatabaseHealthIndicator } from './database.health-indicator.js'
import { DemoCleanupReporter } from './demo-cleanup.reporter.js'
import { SearchIndexReporter } from './search-index.reporter.js'
import { HealthController } from './health.controller.js'
import { HEALTH_INDICATORS } from './health-indicator.js'
import { HealthService } from './health.service.js'
import { SearchHealthIndicator } from './search.health-indicator.js'
import { EXPECTED_SEARCH_INDEXES, SEARCH_INDEXES } from './search-indexes.js'
import { SearchWarmupService } from './search-warmup.service.js'

@Module({
  imports: [SearchModule],
  controllers: [HealthController],
  providers: [
    DatabaseHealthIndicator,
    SearchHealthIndicator,
    DemoCleanupReporter,
    SearchIndexReporter,
    HealthService,
    // Wakes the search engine once at boot. It has no consumer: the class
    // implements OnApplicationBootstrap and Nest calls it (TASK-0101 4.6).
    SearchWarmupService,
    { provide: SEARCH_INDEXES, useValue: EXPECTED_SEARCH_INDEXES },
    {
      // The list is assembled here so that adding a dependency touches this
      // array and nothing inside HealthService.
      provide: HEALTH_INDICATORS,
      useFactory: (database: DatabaseHealthIndicator, search: SearchHealthIndicator) => [
        database,
        search,
      ],
      inject: [DatabaseHealthIndicator, SearchHealthIndicator],
    },
  ],
})
export class HealthModule {}
