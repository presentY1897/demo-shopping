import 'reflect-metadata'

import type { LogLevel } from '@nestjs/common'
import { Logger, VersioningType } from '@nestjs/common'
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'

import { AppModule } from './app.module.js'
import { createNotFoundFallback } from './common/not-found.middleware.js'
import { createRequestContextMiddleware } from './common/request-context.middleware.js'
import type { AppConfig } from './config/app-config.js'
import { EnvValidationError } from './config/env-validation.error.js'
import type { LoadedAppConfig } from './config/load-app-config.js'
import { loadAppConfig } from './config/load-app-config.js'

/**
 * Every route lives under `/api/v<n>`; `v1` is implied when a route omits it.
 *
 * The leading slash is required: Nest mounts its own 404 handler on the raw
 * prefix string, and Express never matches a mount path that does not start
 * with one — an unknown path would fall through to Express's HTML error page
 * instead of the shared error envelope.
 */
const GLOBAL_PREFIX = '/api'
const DEFAULT_VERSION = '1'

/** Ordered by severity; `fatal` is never silenced. */
const LEVELS_BY_SEVERITY: readonly LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose']

function enabledLogLevels(level: AppConfig['logLevel']): LogLevel[] {
  return ['fatal', ...LEVELS_BY_SEVERITY.slice(0, LEVELS_BY_SEVERITY.indexOf(level) + 1)]
}

function corsOptionsFor(config: AppConfig): CorsOptions {
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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  }
}

function logStartup({ config, sources }: LoadedAppConfig): void {
  const logger = new Logger('Bootstrap')
  const envFiles =
    sources.envFiles.length > 0 ? sources.envFiles.join(', ') : '없음 (환경변수만 사용)'

  logger.log(`API 준비 완료 — http://localhost:${config.port}${GLOBAL_PREFIX}/v${DEFAULT_VERSION}`)
  logger.log(`환경 파일: ${envFiles} · 허용 오리진 ${config.corsOrigins.length}개`)
}

async function bootstrap(): Promise<void> {
  const loaded = await loadAppConfig()
  const { config } = loaded

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    logger: enabledLogLevels(config.logLevel),
  })

  // Advertising the framework only helps someone matching known CVEs to a host.
  app.disable('x-powered-by')

  // Registered first so that unmatched routes still get an id and a log line.
  app.use(createRequestContextMiddleware(new Logger('HTTP')))
  app.setGlobalPrefix(GLOBAL_PREFIX)
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: DEFAULT_VERSION })
  app.enableCors(corsOptionsFor(config))
  app.enableShutdownHooks()

  // `init` registers the controllers and Nest's own prefixed 404 handler, so the
  // fallback below has to be added afterwards to end up last in the stack.
  await app.init()
  app.use(createNotFoundFallback())

  await app.listen(config.port, config.host)
  logStartup(loaded)
}

bootstrap().catch((error: unknown) => {
  // The Nest logger may not exist yet, and this has to reach stderr regardless.
  if (error instanceof EnvValidationError) {
    console.error(`\n${error.message}\n`)
  } else {
    console.error('\nAPI 기동에 실패했습니다.\n')
    console.error(error)
  }

  process.exit(1)
})
