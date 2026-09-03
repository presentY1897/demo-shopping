import { Global, Module } from '@nestjs/common'

import { CLOCK, SystemClock } from './clock.js'

/**
 * Publishes the {@link Clock} port.
 *
 * Global because time is needed in every layer and threading an import through
 * each feature module would be ceremony around a single stateless object. A test
 * replaces the binding once, at the composition root, and every service below it
 * sees the fixed instant.
 */
@Global()
@Module({
  providers: [{ provide: CLOCK, useClass: SystemClock }],
  exports: [CLOCK],
})
export class ClockModule {}
