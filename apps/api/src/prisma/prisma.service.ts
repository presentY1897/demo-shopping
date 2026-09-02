import { Inject, Injectable, Logger } from '@nestjs/common'
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

import type { AppConfig } from '../config/app-config.js'
import { APP_CONFIG } from '../config/app-config.js'
import { databasePoolOptions } from './pool-options.js'

/**
 * The application's single Prisma client.
 *
 * It extends `PrismaClient` so that a caller writes `prisma.appMeta.findMany()`
 * with no wrapper in between, and adds exactly two things: a pool built from the
 * validated configuration, and Nest's lifecycle.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name)

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({ adapter: new PrismaPg(databasePoolOptions(config)) })
  }

  /**
   * Opens the pool eagerly, but a failure here is a warning rather than a crash.
   *
   * A database that is down at boot is the same situation as one that goes down
   * a minute later, and the second case cannot take the process with it — the
   * whole point of `/health` reporting `degraded` is that the API stays up and
   * says which dependency is broken. Refusing to boot would also turn every
   * Neon auto-suspend into a failed deploy on Render, where the container is
   * restarted from cold.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.$connect()
      this.logger.log('데이터베이스에 연결했습니다.')
    } catch (error) {
      this.logger.warn(
        `데이터베이스에 연결하지 못했습니다: ${reasonOf(error)}. ` +
          '헬스체크가 database: down 을 보고합니다.',
      )
    }
  }

  /**
   * Closes the pool on shutdown.
   *
   * Reached because `main.ts` calls `enableShutdownHooks()`, so a SIGTERM from
   * the container runtime drains here before the process exits. Skipping it
   * leaves connections open on the server until they time out, which on a small
   * managed Postgres is a real ceiling.
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    await this.$disconnect()
    this.logger.log(
      `데이터베이스 커넥션을 닫았습니다.${signal === undefined ? '' : ` (${signal})`}`,
    )
  }
}

/** The exception class, not its message: the message can contain credentials. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError'
}
