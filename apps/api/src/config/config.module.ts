import type { DynamicModule } from '@nestjs/common'
import { Global, Module } from '@nestjs/common'

import type { AppConfig } from './app-config.js'
import { APP_CONFIG } from './app-config.js'

/**
 * Publishes the already validated configuration to the DI container.
 *
 * There is no loading here on purpose: the config is built and validated before
 * `NestFactory.create` runs, so a bad environment fails while the process is
 * still a plain script rather than half way through wiring modules.
 */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    }
  }
}
