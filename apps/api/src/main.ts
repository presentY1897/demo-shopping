import 'reflect-metadata'

import type { LogLevel } from '@nestjs/common'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'

import { AppModule } from './app.module.js'
import { configureApp, DEFAULT_VERSION, GLOBAL_PREFIX } from './bootstrap/configure-app.js'
import type { AppConfig } from './config/app-config.js'
import { EnvValidationError } from './config/env-validation.error.js'
import type { LoadedAppConfig } from './config/load-app-config.js'
import { loadAppConfig } from './config/load-app-config.js'

/** Ordered by severity; `fatal` is never silenced. */
const LEVELS_BY_SEVERITY: readonly LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose']

function enabledLogLevels(level: AppConfig['logLevel']): LogLevel[] {
  return ['fatal', ...LEVELS_BY_SEVERITY.slice(0, LEVELS_BY_SEVERITY.indexOf(level) + 1)]
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

  // A SIGTERM from the container runtime has to drain the Prisma pool. This is a
  // process concern, which is why it is here and not in `configureApp` — the
  // integration harness boots and closes many applications inside one process.
  app.enableShutdownHooks()

  await configureApp(app, config)

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
