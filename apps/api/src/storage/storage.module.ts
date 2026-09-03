import { Module } from '@nestjs/common'

import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { createObjectStorage, OBJECT_STORAGE } from './object-storage.js'
import { UploadsController } from './uploads.controller.js'
import { UploadsService } from './uploads.service.js'

/**
 * Object storage and the endpoint in front of it.
 *
 * The port is bound from the validated configuration, so "R2 is not set up yet"
 * is decided once at boot rather than checked on every request — and the
 * endpoint's 503 comes from the binding rather than from an `if` the next
 * caller could forget (TASK-0011 4.5).
 */
@Module({
  controllers: [UploadsController],
  providers: [
    UploadsService,
    {
      provide: OBJECT_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createObjectStorage(config.storage),
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
