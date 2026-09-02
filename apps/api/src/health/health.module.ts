import { Module } from '@nestjs/common'

import { DatabaseHealthIndicator } from './database.health-indicator.js'
import { HealthController } from './health.controller.js'
import { HEALTH_INDICATORS } from './health-indicator.js'
import { HealthService } from './health.service.js'
import { SearchHealthIndicator } from './search.health-indicator.js'

@Module({
  controllers: [HealthController],
  providers: [
    DatabaseHealthIndicator,
    SearchHealthIndicator,
    HealthService,
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
