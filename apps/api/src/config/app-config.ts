import type { AppOrigins } from './app-origins.js'
import type { GoogleOAuthConfig } from './google-config.js'
import type { ObjectStorageConfig } from './storage-config.js'

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
  readonly database: {
    readonly url: string
    /** Maximum connections this process holds open. See `DATABASE_POOL_SIZE`. */
    readonly poolSize: number
    /** Deadline for acquiring a connection from the pool. */
    readonly connectTimeoutMs: number
    /** Deadline for the `/health` probe query. */
    readonly healthTimeoutMs: number
  }
  readonly search: {
    readonly host: string
    readonly masterKey: string
    readonly timeoutMs: number
  }
  /**
   * Object storage for uploaded images, or `null` while R2 is not configured.
   *
   * Nullable rather than required because the account is provisioned separately
   * from the code: the API has to run — and every other endpoint has to work —
   * before a bucket exists. The upload endpoint answers 503 until it does
   * (TASK-0011 4.5).
   */
  readonly storage: ObjectStorageConfig | null
  /**
   * Google OAuth credentials, or `null` while they are not configured.
   *
   * Nullable for the same reason `storage` is, plus one more: CI injects no
   * Google secrets, so a required value here would fail every job in the
   * repository. Sign-in answers 503 until it is set (TASK-0021 4장).
   */
  readonly googleOAuth: GoogleOAuthConfig | null
  /**
   * Secrets and lifetimes for sessions (TASK-0022).
   *
   * Not nullable, unlike {@link storage} and {@link googleOAuth}: a process
   * that cannot sign a token cannot serve an authenticated request at all, so
   * "unconfigured" is a boot failure rather than one endpoint answering 503.
   */
  readonly auth: {
    readonly jwtSecret: string
    /** Access token lifetime. Short: there is no revocation list (R4). */
    readonly accessTokenTtlSeconds: number
    /** Refresh token lifetime, matching the cookie's `Max-Age`. */
    readonly refreshTokenTtlSeconds: number
  }
  /** Exact origins allowed by CORS. Anything else is rejected. */
  readonly corsOrigins: readonly string[]
  /**
   * Which of {@link corsOrigins} belongs to which app.
   *
   * Derived rather than configured: the OAuth callback redirects to one of
   * these, and picking from the list the operator already vetted is what makes
   * an open redirect unrepresentable (`app-origins.ts`).
   */
  readonly appOrigins: AppOrigins
}
