import { Module } from '@nestjs/common'

import { SearchModule } from '../search/search.module.js'

import { DatabaseHealthIndicator } from './database.health-indicator.js'
import { DemoCleanupReporter } from './demo-cleanup.reporter.js'
import { DeliverySimulatorHealthIndicator } from './delivery-simulator.health-indicator.js'
import { SearchIndexReporter } from './search-index.reporter.js'
import { HealthController } from './health.controller.js'
import { HEALTH_INDICATORS } from './health-indicator.js'
import { HealthService } from './health.service.js'
import { OrderConfirmHealthIndicator } from './order-confirm.health-indicator.js'
import { PaymentReconcileHealthIndicator } from './payment-reconcile.health-indicator.js'
import { PaymentStragglerHealthIndicator } from './payment-straggler.health-indicator.js'
import { PaymentWebhookReporter } from './payment-webhook.reporter.js'
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
    PaymentReconcileHealthIndicator,
    OrderConfirmHealthIndicator,
    PaymentStragglerHealthIndicator,
    DeliverySimulatorHealthIndicator,
    DemoCleanupReporter,
    SearchIndexReporter,
    // 지표가 아니라 보고자다 — 웹훅이 한 건도 안 온 것은 고장이 아니라서 전체
    // 판정에 실리지 않는다 (`payment-webhook.reporter.ts`).
    PaymentWebhookReporter,
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
        // 대사가 멈추면 결과를 모르는 결제가 갇히고, 그 사람은 다시 결제할 수도
        // 없다 (TASK-0056 · D-220). 여기서도 아무것도 실패하지 않는 것이 위험이다.
        paymentReconcile: PaymentReconcileHealthIndicator,
        // 자동 구매확정이 멈추면 배송이 끝난 주문이 확정되지 않고, 정산도 적립금도
        // 시작되지 않는다 (TASK-0064). 여기서도 아무것도 실패하지 않는 것이 위험이다.
        orderConfirm: OrderConfirmHealthIndicator,
        // 낙오 배치가 멈추면 돈을 낸 사람의 주문이 영원히 「결제 대기」로 남고,
        // 승인만 된 결제가 그 사람의 카드 한도를 영영 문다 (TASK-0057 · D-221).
        // 여기서도 아무것도 실패하지 않는 것이 위험이다.
        paymentStraggler: PaymentStragglerHealthIndicator,
        // 시뮬레이터가 멈추면 발송된 주문이 영영 `SHIPPED` 에 머물고 구매확정 ·
        // 정산 · 반품이 열리지 않는다 (TASK-0062). 여기서도 아무것도 실패하지
        // 않는 것이 위험이다.
        deliverySimulator: DeliverySimulatorHealthIndicator,
      ) => [
        database,
        search,
        reservationExpiry,
        paymentReconcile,
        orderConfirm,
        paymentStraggler,
        deliverySimulator,
      ],
      inject: [
        DatabaseHealthIndicator,
        SearchHealthIndicator,
        ReservationExpiryHealthIndicator,
        PaymentReconcileHealthIndicator,
        OrderConfirmHealthIndicator,
        PaymentStragglerHealthIndicator,
        DeliverySimulatorHealthIndicator,
      ],
    },
  ],
})
export class HealthModule {}
