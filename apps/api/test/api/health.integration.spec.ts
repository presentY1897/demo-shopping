import { ApiClientError, healthResponseSchema } from '@shopping/shared'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { useApiApp } from '../support/api-app.js'
import { useDatabase } from '../support/database.js'

/**
 * `GET /api/v1/health` over a real socket, against this worker's real database.
 *
 * The endpoint is small, which is what makes it the right first subject: it
 * exercises every part of the harness — the app boots the way `main.ts` boots
 * it, the request crosses a TCP connection, the database indicator runs an
 * actual query — without any domain logic in the way.
 *
 * Gate C3 holds structurally here rather than by discipline. `client.getHealth()`
 * parses the body with `healthResponseSchema` from `@shopping/shared`, the same
 * schema TASK-0107's front-end mocks are checked against, so a renamed field
 * fails this spec even though no assertion mentions it.
 */

const db = useDatabase()
const api = useApiApp({ database: db })

describe('health over HTTP', () => {
  it('reports the database as ok, having actually queried it', async () => {
    const health = await api.client.getHealth()

    expect(health.database).toBe('ok')
    expect(health.version).toBe('0.0.0-test')
    expect(health.uptime).toBeGreaterThanOrEqual(0)
  })

  it('reports the mocked search host as down, and the API as degraded', async () => {
    // Meilisearch is a mocked dependency (QUALITY-GATES 6장); the harness points
    // at a closed port so the answer is the same locally and in CI.
    const health = await api.client.getHealth()

    expect(health.search).toBe('down')
    expect(health.status).toBe('degraded')
  })

  it('answers a body the shared schema accepts', async () => {
    const raw: unknown = await fetch(`${api.baseUrl}/api/v1/health`).then((response) =>
      response.json(),
    )

    expect(healthResponseSchema.safeParse(raw).success).toBe(true)
  })

  it('fails as malformed_response when a response does not match its schema', async () => {
    // The proof that C3 is structural: nothing had to remember to assert it.
    const wrong = api.client.request({
      path: '/health',
      schema: z.object({ db: z.string() }),
    })

    await expect(wrong).rejects.toBeInstanceOf(ApiClientError)
    await expect(wrong).rejects.toMatchObject({ kind: 'malformed_response' })
  })

  it('still answers 200 when a dependency is down', async () => {
    const response = await fetch(`${api.baseUrl}/api/v1/health`)

    // A load balancer must not pull the instance out of rotation because
    // Meilisearch is unreachable.
    expect(response.status).toBe(200)
  })
})

describe('health with an unreachable database', () => {
  const broken = useApiApp({
    config: {
      database: {
        // Port 9 (discard) is reserved and never accepts a connection.
        url: 'postgresql://shopping:shopping@127.0.0.1:9/shopping',
        poolSize: 2,
        connectTimeoutMs: 500,
        healthTimeoutMs: 500,
      },
    },
  })

  it('reports database down without taking the API with it', async () => {
    const health = await broken.client.getHealth()

    expect(health.database).toBe('down')
    expect(health.status).toBe('degraded')
  })
})
