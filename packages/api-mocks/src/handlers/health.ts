import { http, HttpResponse } from 'msw'

import { healthOk } from '../fixtures/health'
import { mockPaths } from '../paths'

/** `GET /api/v1/health` — a healthy API. Failure variants live in `failures.ts`. */
export const healthHandlers = [http.get(mockPaths.health, () => HttpResponse.json(healthOk))]
