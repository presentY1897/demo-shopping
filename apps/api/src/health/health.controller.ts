import { Controller, Get } from '@nestjs/common'
import type { HealthResponse } from '@shopping/shared'

import { PublicEndpoint } from '../auth/public-endpoint.decorator.js'
import { HealthService } from './health.service.js'

@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * `GET /api/v1/health` — always 200 while the process is serving.
   *
   * Public by declaration, not by omission: the platform's own probes call it
   * with no credentials, and under deny-by-default an endpoint that says nothing
   * is refused (see `PermissionGuard`).
   */
  @Get()
  @PublicEndpoint()
  check(): Promise<HealthResponse> {
    return this.health.check()
  }
}
