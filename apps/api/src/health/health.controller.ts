import { Controller, Get } from '@nestjs/common'
import type { HealthResponse } from '@shopping/shared'

import { HealthService } from './health.service.js'

@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** `GET /api/v1/health` — always 200 while the process is serving. */
  @Get()
  check(): Promise<HealthResponse> {
    return this.health.check()
  }
}
