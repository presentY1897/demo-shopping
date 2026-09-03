import type { DynamicModule } from '@nestjs/common'
import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'

import { AuthModule } from './auth/auth.module.js'
import { AllExceptionsFilter } from './common/all-exceptions.filter.js'
import { ClockModule } from './common/clock.module.js'
import { ConfigModule } from './config/config.module.js'
import type { AppConfig } from './config/app-config.js'
import { HealthModule } from './health/health.module.js'
import { PrismaModule } from './prisma/prisma.module.js'
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
        HealthModule,
        UsersModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    }
  }
}
