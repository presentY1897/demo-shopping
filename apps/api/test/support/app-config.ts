import type { AppConfig } from '../../src/config/app-config.js'
import type { AppOrigins } from '../../src/config/app-origins.js'
import { resolveAppOrigins } from '../../src/config/app-origins.js'
import type { GoogleOAuthConfig } from '../../src/config/google-config.js'
import type { ObjectStorageConfig } from '../../src/config/storage-config.js'
import type { TossConfig } from '../../src/config/toss-config.js'

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
  /**
   * 토스 자격증명. **기본값이 `null` 이다** — Google·R2 와 반대다.
   *
   * 그 둘은 설정된 쪽이 보통이라 기본값이 값이지만, 토스는 설정하는 순간
   * `TossProvider` 가 레지스트리에 붙고 그 프로바이더는 **바깥으로 HTTP 를 건다.**
   * 기본으로 켜 두면 `TOSS_CLIENT` 를 대역으로 바꾸는 것을 잊은 스펙이 실제
   * 토스 서버를 부르게 되고, 그것은 A6(외부 호출 없음)의 위반이자 CI 에서만 깨지는
   * 종류의 실패다. `null` 이 기본이면 **키와 대역이 항상 같이 온다** — 토스를 켜는
   * 스펙은 둘 다 넘겨야 하므로 한쪽만 잊을 수 없다 (TASK-0055 4.1).
   */
  readonly toss?: TossConfig | null
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
/**
 * 존재하지 않는 상점의 키.
 *
 * 형식은 실제와 같다 — 접두어 `test_ck_` · `test_sk_` 는 토스가 테스트 키에 붙이는
 * 것이고, 여기서 그 모양을 지키는 이유는 번들 검사(TASK-0055 4.4)가 `test_sk_` 를
 * 찾기 때문이다. 값 자체는 아무 데도 닿지 않는다 — `TOSS_CLIENT` 가 대역이다.
 */
export const testTossConfig: TossConfig = {
  clientKey: 'test_ck_0000000000000000000000000000',
  secretKey: 'test_sk_0000000000000000000000000000',
}

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
  toss = null,
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
      /**
       * One index per vitest worker.
       *
       * The same reasoning as the per-worker databases: two spec files that
       * shared an index cleared each other's documents mid-assertion, and the
       * failures read as the search being broken rather than as two tests
       * standing on each other. Measured — running the two search specs together
       * failed five assertions that both files pass alone.
       */
      productsIndex: `products_test_${process.env.VITEST_WORKER_ID ?? '0'}`,
    },
    storage,
    googleOAuth,
    toss,
    auth: {
      jwtSecret: TEST_JWT_SECRET,
      accessTokenTtlSeconds,
      refreshTokenTtlSeconds: 14 * 24 * 60 * 60,
    },
    corsOrigins,
    appOrigins,
    // 재현 장치는 기본적으로 꺼져 있다 — 그것을 켜야 하는 스펙이 직접 켠다.
    paymentSimulation: 'off',
  }
}
