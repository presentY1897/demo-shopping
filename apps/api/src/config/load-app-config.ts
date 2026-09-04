import type { AppConfig } from './app-config.js'
import type { AppOrigins } from './app-origins.js'
import { resolveAppOrigins } from './app-origins.js'
import { deriveEnvFromPortOffset } from './derived-env.js'
import type { GoogleOAuthConfig } from './google-config.js'
import { resolveGoogleOAuthConfig } from './google-config.js'
import { EnvValidationError } from './env-validation.error.js'
import type { Env, EnvIssue } from './env.schema.js'
import { parseEnv } from './env.schema.js'
import { mergeEnv } from './merge-env.js'
import { parseOriginList } from './origins.js'
import type { ObjectStorageConfig } from './storage-config.js'
import { resolveObjectStorageConfig } from './storage-config.js'
import { readPackageVersion } from './package-version.js'
import { findRepoRoot, loadEnvFiles } from './workspace.js'

/** Used only when `apps/api/package.json` cannot be read (unexpected layout). */
const UNKNOWN_VERSION = '0.0.0-unknown'

export interface LoadedAppConfig {
  readonly config: AppConfig
  /** What the loader actually used, for the one-line boot summary. */
  readonly sources: {
    readonly envFiles: readonly string[]
    readonly portOffset: number | null
  }
}

interface Resolved {
  readonly version: string
  readonly corsOrigins: readonly string[]
  readonly appOrigins: AppOrigins
  readonly storage: ObjectStorageConfig | null
  readonly googleOAuth: GoogleOAuthConfig | null
}

function toAppConfig(env: Env, resolved: Resolved): AppConfig {
  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    host: env.API_HOST,
    port: env.API_PORT,
    logLevel: env.LOG_LEVEL,
    version: resolved.version,
    database: {
      url: env.DATABASE_URL,
      poolSize: env.DATABASE_POOL_SIZE,
      connectTimeoutMs: env.DATABASE_CONNECT_TIMEOUT_MS,
      healthTimeoutMs: env.DATABASE_HEALTH_TIMEOUT_MS,
    },
    search: {
      host: env.MEILI_HOST,
      masterKey: env.MEILI_MASTER_KEY,
      timeoutMs: env.MEILI_HEALTH_TIMEOUT_MS,
    },
    storage: resolved.storage,
    googleOAuth: resolved.googleOAuth,
    corsOrigins: resolved.corsOrigins,
    appOrigins: resolved.appOrigins,
  }
}

/**
 * Builds the configuration of this process, or throws {@link EnvValidationError}.
 *
 * Order matters: the env files are loaded first so that `PORT_OFFSET` is visible
 * to the derivation step, the derived ports are layered underneath the real
 * environment, and only the merged result is validated. A variable that is
 * missing at this point is missing for good, which is why this runs before the
 * Nest application is created rather than inside a provider.
 */
export async function loadAppConfig(): Promise<LoadedAppConfig> {
  const repoRoot = findRepoRoot()
  const envFiles = repoRoot === null ? [] : loadEnvFiles(repoRoot)

  const derived = await deriveEnvFromPortOffset(repoRoot, process.env)
  const merged = mergeEnv(process.env, derived.values)
  const parsed = parseEnv(merged)
  // Read from the merged record rather than from `Env`: R2 is configured as a
  // set — all of it or none of it — and that rule cannot be stated as six
  // independent field validations (`storage-config.ts`).
  const storage = resolveObjectStorageConfig(merged)
  // Read from the merged record for the same reason as R2: "both or neither"
  // is a rule about a set, not about either field on its own.
  const googleOAuth = resolveGoogleOAuthConfig(merged)

  const issues: EnvIssue[] = [...derived.issues, ...storage.issues, ...googleOAuth.issues]
  if (!parsed.ok) issues.push(...parsed.issues)

  if (!parsed.ok || issues.length > 0) throw new EnvValidationError(issues)

  const { origins, invalid } = parseOriginList(parsed.env.CORS_ORIGINS)
  if (invalid.length > 0) {
    throw new EnvValidationError([
      { variable: 'CORS_ORIGINS', reason: 'http(s) 오리진 목록이어야 합니다' },
    ])
  }

  const version = parsed.env.API_VERSION ?? readPackageVersion() ?? UNKNOWN_VERSION
  // An app with no origin in the list simply cannot start a sign-in; that is a
  // 400 on one endpoint, not a reason to refuse the whole process. A deployment
  // that serves only the shop is a legitimate configuration.
  const appOrigins = resolveAppOrigins(origins, derived.webPorts)

  return {
    config: toAppConfig(parsed.env, {
      version,
      corsOrigins: origins,
      appOrigins,
      storage: storage.config,
      googleOAuth: googleOAuth.config,
    }),
    sources: { envFiles, portOffset: derived.offset },
  }
}
