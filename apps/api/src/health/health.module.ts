import { Module } from '@nestjs/common'

import { SearchModule } from '../search/search.module.js'

import { DatabaseHealthIndicator } from './database.health-indicator.js'
import { DemoCleanupReporter } from './demo-cleanup.reporter.js'
import { SearchIndexReporter } from './search-index.reporter.js'
import { HealthController } from './health.controller.js'
import { HEALTH_INDICATORS } from './health-indicator.js'
import { HealthService } from './health.service.js'
import { ReservationExpiryHealthIndicator } from './reservation-expiry.health-indicator.js'
import { SearchHealthIndicator } from './search.health-indicator.js'
import { EXPECTED_SEARCH_INDEXES, SEARCH_INDEXES } from './search-indexes.js'
import { SearchWarmupService } from './search-warmup.service.js'

@Module({
  imports: [SearchModule],
  controllers: [HealthController],
  providers: [
    DatabaseHealthIndicator,
    SearchHealthIndicator,
    ReservationExpiryHealthIndicator,
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
      useFactory: (
        database: DatabaseHealthIndicator,
        search: SearchHealthIndicator,
        // 만료 청소기는 API 가 말을 거는 외부 시스템이 아니지만 이 배열에 있다.
        // 멈추면 잡아 둔 재고가 영영 풀리지 않고 아무것도 실패하지 않기 때문이다
        // (TASK-0051 F6). 여기서 빠지면 `/health` 의 `reservationExpiry.status` 가
        // `down` 으로 드러난다 — 조용히 맞는 것처럼 보이지 않는다.
        reservationExpiry: ReservationExpiryHealthIndicator,
      ) => [database, search, reservationExpiry],
      inject: [DatabaseHealthIndicator, SearchHealthIndicator, ReservationExpiryHealthIndicator],
    },
  ],
})
export class HealthModule {}
