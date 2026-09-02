import { Module } from '@nestjs/common'

import { HealthController } from './health.controller.js'
import { HEALTH_INDICATORS } from './health-indicator.js'
import { HealthService } from './health.service.js'
import { SearchHealthIndicator } from './search.health-indicator.js'

@Module({
  controllers: [HealthController],
  providers: [
    SearchHealthIndicator,
    HealthService,
    {
      // The list is assembled here so that adding a dependency (TASK-0005 adds
      // the database) touches this array and nothing inside HealthService.
      provide: HEALTH_INDICATORS,
      useFactory: (search: SearchHealthIndicator) => [search],
      inject: [SearchHealthIndicator],
    },
  ],
})
export class HealthModule {}
