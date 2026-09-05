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
    /**
     * Which index the catalogue lives in.
     *
     * Configurable for one reason: **tests**. The database harness gives each
     * vitest worker its own database, and two specs that shared one index would
     * clear each other's documents mid-assertion the same way two specs sharing
     * a database would — measured, when they did exactly that. Production has
     * one value and always will.
     */
    readonly productsIndex: string
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
  /**
   * 결제 실패 재현 장치 (TASK-0054 4.4 · 4.5).
   *
   * | 값 | 무엇이 일어나나 |
   * | --- | --- |
   * | `off` | 아무 장치도 없다. 운영의 값이다 |
   * | `delay` | 승인이 늦게 끝난다. 그러나 **끝난다** (F4) |
   * | `timeout` | 승인이 마감을 넘겨 **프로바이더가 스스로 끊는다** (F5) |
   *
   * 지연과 타임아웃이 **다른 값**인 것이 4.5 다. 지연을 아주 길게 잡는 것으로
   * 타임아웃을 흉내 내면 재는 것이 프로바이더가 아니라 검사의 인내심이 된다.
   *
   * 한도 초과와 카드 정지는 이 값과 무관하게 언제나 일어난다 — 그쪽은 시연 장치가
   * 아니라 정상 기능이고, 운영에서도 일어나야 한다.
   */
  readonly paymentSimulation: PaymentSimulation
}

/** 결제 실패 재현의 세 가지 모드. */
export type PaymentSimulation = 'off' | 'delay' | 'timeout'
