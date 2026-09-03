import type { AppConfig } from '../../src/config/app-config.js'
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
}: TestConfigOptions): AppConfig {
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
    corsOrigins: ['http://127.0.0.1:3000'],
  }
}
