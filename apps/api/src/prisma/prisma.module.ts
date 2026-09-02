import { Global, Module } from '@nestjs/common'

import { PrismaService } from './prisma.service.js'

/**
 * Publishes the Prisma client to the DI container.
 *
 * Global for the same reason `ConfigModule` is: one pool per process is the
 * point, and a per-module provider would let a future module quietly construct
 * a second one. Importing it everywhere would only be ceremony around a
 * singleton that must stay a singleton.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
