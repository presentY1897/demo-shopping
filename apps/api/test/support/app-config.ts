import type { AppConfig } from '../../src/config/app-config.js'
import type { AppOrigins } from '../../src/config/app-origins.js'
import { resolveAppOrigins } from '../../src/config/app-origins.js'
import type { GoogleOAuthConfig } from '../../src/config/google-config.js'
import type { ObjectStorageConfig } from '../../src/config/storage-config.js'

/**
 * Configuration for an application booted inside a test.
 *
 * Built here rather than through `loadAppConfig()` on purpose: that function
 * reads `.env`, which is git-ignored and therefore absent in CI, and it would
 * hand the test the *development* database. Everything a spec cares about —
 * which database, which search host — is passed in instead.
 */
export interface TestConfigOptions {
  readonly databaseUrl: string
  readonly searchHost?: string
  readonly version?: string
  /** `null` boots the API as if R2 were not configured (TASK-0011 4.5). */
  readonly storage?: ObjectStorageConfig | null
  /** `null` boots the API as if Google were not configured (TASK-0021 F8). */
  readonly googleOAuth?: GoogleOAuthConfig | null
  /** Overrides the derived three-app allow list; `[]` leaves every app unreachable. */
  readonly corsOrigins?: readonly string[]
  /** Shortens the access token so a spec can watch one expire without waiting. */
  readonly accessTokenTtlSeconds?: number
}

/**
 * Credentials for a bucket that does not exist, and cannot.
 *
 * Presigning is pure computation — no request leaves the process — so the real
 * implementation runs in every spec and nothing is mocked (gate A6 applies to
 * the database; QUALITY-GATES 6장 keeps R2 itself out of the suite). The hosts
 * are `.invalid`, reserved by RFC 6761 and never resolvable, so a future change
 * that accidentally introduces a call fails loudly instead of reaching out.
 */
export const testStorageConfig: ObjectStorageConfig = {
  endpoint: 'https://storage.test.invalid',
  bucket: 'shopping-test',
  region: 'auto',
  accessKeyId: 'test-access-key-id',
  secretAccessKey: 'test-secret-access-key-0000000000000000',
  publicBaseUrl: 'https://cdn.test.invalid',
}

/**
 * Credentials for an OAuth client that does not exist.
 *
 * Google is a mocked dependency (QUALITY-GATES 6장) and reaches the suite only
 * through the `GOOGLE_OAUTH` port, so nothing here is ever sent anywhere. They
 * are present rather than `null` because most specs exercise the configured
 * path; F8 is the one that passes `null`.
 */
export const testGoogleOAuthConfig: GoogleOAuthConfig = {
  clientId: 'test-client-id.apps.googleusercontent.com',
  clientSecret: 'test-client-secret',
}

/**
 * Origins for the three apps, spelled the way `derived-env.ts` derives them.
 *
 * The ports are the base ports with no offset: a spec asserts on which app a
 * redirect points at, not on which worktree it ran in.
 */
export const testCorsOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
] as const

const TEST_WEB_PORTS = { shop: 3000, seller: 3001, admin: 3002 } as const

/**
 * A signing key that exists only here.
 *
 * Required rather than nullable in `AppConfig`, so every booted app has one —
 * which is also why CI needs no secret of its own (TASK-0022 R3).
 */
const TEST_JWT_SECRET = 'test-jwt-secret-0000000000000000000000'

/**
 * A port on the loopback interface that nothing listens on.
 *
 * The search indicator is expected to report `down` in every integration spec:
 * Meilisearch is a mocked dependency (QUALITY-GATES 6장) and pointing at a dead
 * port makes the result the same locally, where the container is usually up,
 * and in CI, where it is not.
 */
const CLOSED_PORT = 'http://127.0.0.1:9'

export function testAppConfig({
  databaseUrl,
  searchHost = CLOSED_PORT,
  version = '0.0.0-test',
  storage = testStorageConfig,
  googleOAuth = testGoogleOAuthConfig,
  corsOrigins = testCorsOrigins,
  accessTokenTtlSeconds = 15 * 60,
}: TestConfigOptions): AppConfig {
  // Resolved by the same function the loader uses, so a spec that asserts on a
  // redirect target is exercising the real mapping rather than a hand-written
  // one that could disagree with it.
  const appOrigins: AppOrigins = resolveAppOrigins(corsOrigins, TEST_WEB_PORTS)

  return {
    nodeEnv: 'test',
    isProduction: false,
    host: '127.0.0.1',
    // Overridden by `listen(0)`; the harness never binds a fixed port.
    port: 0,
    logLevel: 'error',
    version,
    database: {
      url: databaseUrl,
      // Small on purpose, but larger than one: a pool of a single connection
      // would serialise the concurrent calls A7 asks for and the race under
      // test could never happen.
      poolSize: 5,
      connectTimeoutMs: 5_000,
      healthTimeoutMs: 1_000,
    },
    search: {
      host: searchHost,
      masterKey: 'test-master-key',
      timeoutMs: 300,
    },
    storage,
    googleOAuth,
    auth: {
      jwtSecret: TEST_JWT_SECRET,
      accessTokenTtlSeconds,
      refreshTokenTtlSeconds: 14 * 24 * 60 * 60,
    },
    corsOrigins,
    appOrigins,
  }
}
