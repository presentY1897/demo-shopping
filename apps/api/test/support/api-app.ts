import 'reflect-metadata'

import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import type { INestApplication } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import type { ApiClient, FetchLike } from '@shopping/shared'
import { createApiClient } from '@shopping/shared'
import { afterAll, beforeAll } from 'vitest'

import { AppModule } from '../../src/app.module.js'
import { configureApp } from '../../src/bootstrap/configure-app.js'
import type { AppConfig } from '../../src/config/app-config.js'
import { CLOCK } from '../../src/common/clock.js'
import { testAppConfig } from './app-config.js'
import type { TestClock } from './clock.js'
import { DEFAULT_TEST_INSTANT, fixedClock } from './clock.js'
import type { CookieJar } from './cookie-jar.js'
import { createCookieJar } from './cookie-jar.js'
import type { Database } from './database.js'

/**
 * Boots the real API over real HTTP for the length of a spec file.
 *
 * Three decisions, all made in TASK-0106 4.4:
 *
 * - **`listen(0)` and a socket, not `getHttpServer()`.** An in-process call is
 *   faster but two of them do not actually overlap, and cookies, CORS and header
 *   handling drop out of the test's reach.
 * - **`createApiClient` and not supertest.** The response therefore passes
 *   through the very client the front-ends use, so contract gate C3 holds
 *   structurally: a response that does not match its zod schema fails as
 *   `ApiClientError { kind: 'malformed_response' }` whether or not the spec
 *   thought to assert it.
 * - **`configureApp` and not a copy of it.** The prefix, versioning and
 *   middleware order come from the same function `main.ts` calls.
 */
export interface ApiAppOptions {
  /** The worker database this app talks to. Its URL is all that is used. */
  readonly database?: Database
  /** Defaults to a clock fixed at {@link DEFAULT_TEST_INSTANT}. */
  readonly clock?: TestClock
  /** Applied over {@link testAppConfig}, e.g. to point at a dead database. */
  readonly config?: Partial<AppConfig>
}

export interface ApiApp {
  readonly app: INestApplication
  /** Origin the app is listening on, e.g. `http://127.0.0.1:41235`. */
  readonly baseUrl: string
  /** The `@shopping/shared` client, wired to this app and to the cookie jar. */
  readonly client: ApiClient
  readonly cookies: CookieJar
  readonly clock: TestClock
  /** Resolves a provider, for asserting what the container actually bound. */
  resolve: <T>(token: unknown) => T
}

function serverOrigin(app: INestApplication): string {
  const address = (app.getHttpServer() as Server).address() as AddressInfo

  return `http://127.0.0.1:${String(address.port)}`
}

/**
 * Sends the jar's cookies and stores whatever comes back.
 *
 * Node's `fetch` keeps no cookie state of its own, so this closes the loop that
 * a browser would close — and leaves the attributes visible for assertions.
 */
function cookieAwareFetch(jar: CookieJar): FetchLike {
  return async (input, init) => {
    const headers = new Headers(init.headers)
    const cookie = jar.header()

    if (cookie !== undefined) headers.set('Cookie', cookie)

    const response = await fetch(input, { ...init, headers })

    jar.capture(response)
    return response
  }
}

export function useApiApp(options: ApiAppOptions = {}): ApiApp {
  const clock = options.clock ?? fixedClock(DEFAULT_TEST_INSTANT)
  const cookies = createCookieJar()

  let app: INestApplication | null = null
  let baseUrl = ''
  let client: ApiClient | null = null

  function started<T>(value: T | null, what: string): T {
    if (value === null) throw new Error(`${what} 은(는) beforeAll 이후에만 사용할 수 있습니다.`)
    return value
  }

  beforeAll(async () => {
    const databaseUrl = options.database?.url ?? process.env.DATABASE_URL

    if (databaseUrl === undefined) throw new Error('DATABASE_URL 을 확인할 수 없습니다.')

    const config: AppConfig = { ...testAppConfig({ databaseUrl }), ...options.config }

    // `overrideProvider` is the reason `@nestjs/testing` is here: the clock is
    // swapped at the composition root, so every service below it sees the fixed
    // instant without any of them knowing it is in a test.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile()

    const created = moduleRef.createNestApplication<NestExpressApplication>({ logger: false })

    await configureApp(created, config)
    await created.listen(0, '127.0.0.1')

    app = created
    baseUrl = serverOrigin(created)
    client = createApiClient({ baseUrl, appId: 'shop', fetch: cookieAwareFetch(cookies) })
  })

  afterAll(async () => {
    await app?.close()
    app = null
    client = null
  })

  return {
    get app(): INestApplication {
      return started(app, 'app')
    },
    get baseUrl(): string {
      return started(baseUrl === '' ? null : baseUrl, 'baseUrl')
    },
    get client(): ApiClient {
      return started(client, 'client')
    },
    cookies,
    clock,
    resolve<T>(token: unknown): T {
      return started(app, 'app').get<T>(token as never)
    },
  }
}
