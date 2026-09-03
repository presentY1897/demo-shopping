import { Logger, VersioningType } from '@nestjs/common'
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { APP_ID_HEADER } from '@shopping/shared'

import { createNotFoundFallback } from '../common/not-found.middleware.js'
import { createRequestContextMiddleware } from '../common/request-context.middleware.js'
import type { AppConfig } from '../config/app-config.js'

/**
 * Everything that turns a created Nest application into *this* API, extracted
 * from `main.ts` so that the integration harness boots the same object.
 *
 * The alternative — the harness repeating the prefix, the versioning and the
 * middleware order — is the failure this task exists to remove: the suite would
 * be testing an application that resembles production instead of the one that
 * ships, and the first divergence would show up in a browser rather than in CI.
 *
 * Process level concerns stay in `main.ts`: shutdown hooks and `listen` belong
 * to the process, not to the HTTP wiring.
 */

/**
 * Every route lives under `/api/v<n>`; `v1` is implied when a route omits it.
 *
 * The leading slash is required: Nest mounts its own 404 handler on the raw
 * prefix string, and Express never matches a mount path that does not start
 * with one — an unknown path would fall through to Express's HTML error page
 * instead of the shared error envelope.
 */
export const GLOBAL_PREFIX = '/api'
export const DEFAULT_VERSION = '1'

export function corsOptionsFor(config: AppConfig): CorsOptions {
  const allowed = new Set(config.corsOrigins)

  return {
    origin(origin: string | undefined, callback: (error: Error | null, allow: boolean) => void) {
      // A request without an `Origin` header is not a cross origin request:
      // curl, a health probe and a server-to-server call all omit it. CORS
      // protects browsers, and a browser always sends one.
      callback(null, origin === undefined || allowed.has(origin))
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // APP_ID_HEADER identifies which of the three front ends is calling. The apps
    // do not share cookies, so credentials alone cannot tell them apart. It comes
    // from @shopping/shared so the client and this allow-list cannot drift apart.
    allowedHeaders: ['Content-Type', 'Authorization', APP_ID_HEADER, 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  }
}

/** Applies the wiring and initialises the app; the caller then calls `listen`. */
export async function configureApp(app: NestExpressApplication, config: AppConfig): Promise<void> {
  // Advertising the framework only helps someone matching known CVEs to a host.
  app.disable('x-powered-by')

  // Registered first so that unmatched routes still get an id and a log line.
  app.use(createRequestContextMiddleware(new Logger('HTTP')))
  app.setGlobalPrefix(GLOBAL_PREFIX)
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: DEFAULT_VERSION })
  app.enableCors(corsOptionsFor(config))

  // `init` registers the controllers and Nest's own prefixed 404 handler, so the
  // fallback below has to be added afterwards to end up last in the stack.
  await app.init()
  app.use(createNotFoundFallback())
}
