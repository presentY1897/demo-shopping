import type { DynamicModule } from '@nestjs/common'
import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'

import { AuthModule } from './auth/auth.module.js'
import { CartModule } from './cart/cart.module.js'
import { CatalogModule } from './catalog/catalog.module.js'
import { ClaimModule } from './claims/claim.module.js'
import { CouponModule } from './coupons/coupon.module.js'
import { AllExceptionsFilter } from './common/all-exceptions.filter.js'
import { ClockModule } from './common/clock.module.js'
import { ConfigModule } from './config/config.module.js'
import { DemoModule } from './demo/demo.module.js'
import type { AppConfig } from './config/app-config.js'
import { HealthModule } from './health/health.module.js'
import { PrismaModule } from './prisma/prisma.module.js'
import { OrderModule } from './orders/order.module.js'
import { PaymentModule } from './payment/payment.module.js'
import { PointsModule } from './points/points.module.js'
import { ProfileModule } from './profile/profile.module.js'
import { ReservationModule } from './reservation/reservation.module.js'
import { ReturnModule } from './claims/return.module.js'
import { SearchModule } from './search/search.module.js'
import { SellersModule } from './sellers/sellers.module.js'
import { SettlementModule } from './settlement/settlement.module.js'
import { ShipmentModule } from './shipping/shipment.module.js'
import { StockModule } from './stock/stock.module.js'
import { StorageModule } from './storage/storage.module.js'
import { UsersModule } from './users/users.module.js'

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        ClockModule,
        PrismaModule,
        AuthModule,
        CartModule,
        CatalogModule,
        ClaimModule,
        CouponModule,
        DemoModule,
        HealthModule,
        OrderModule,
        PaymentModule,
        PointsModule,
        ProfileModule,
        ReservationModule,
        ReturnModule,
        SearchModule,
        SellersModule,
        SettlementModule,
        ShipmentModule,
        StockModule,
        StorageModule,
        UsersModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    }
  }
}
