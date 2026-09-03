import type { AppConfig } from '../../src/config/app-config.js'

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
    corsOrigins: ['http://127.0.0.1:3000'],
  }
}
