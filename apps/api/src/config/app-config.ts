/** Injection token for {@link AppConfig}; the object itself has no class to key on. */
export const APP_CONFIG = Symbol('APP_CONFIG')

export type NodeEnv = 'development' | 'test' | 'production'

export type LogLevel = 'error' | 'warn' | 'log' | 'debug' | 'verbose'

/**
 * The validated configuration of one API process.
 *
 * Everything the application reads from the environment passes through here,
 * so `process.env` is never touched outside of `src/config`. That is what makes
 * a missing variable a boot failure instead of an `undefined` surfacing days
 * later inside a request handler.
 */
export interface AppConfig {
  readonly nodeEnv: NodeEnv
  readonly isProduction: boolean
  /** Interface to bind to. `0.0.0.0` so that a container publishes correctly. */
  readonly host: string
  readonly port: number
  readonly logLevel: LogLevel
  /** Reported by `GET /api/v1/health` and by the `X-Api-Version` header. */
  readonly version: string
  /** Not used until TASK-0005; validated now so a typo fails at boot. */
  readonly databaseUrl: string
  readonly search: {
    readonly host: string
    readonly masterKey: string
    readonly timeoutMs: number
  }
  /** Exact origins allowed by CORS. Anything else is rejected. */
  readonly corsOrigins: readonly string[]
}
