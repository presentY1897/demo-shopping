import type { AppConfig } from './app-config.js'
import { deriveEnvFromPortOffset } from './derived-env.js'
import { EnvValidationError } from './env-validation.error.js'
import type { Env, EnvIssue } from './env.schema.js'
import { parseEnv } from './env.schema.js'
import { mergeEnv } from './merge-env.js'
import { parseOriginList } from './origins.js'
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

function toAppConfig(env: Env, version: string, corsOrigins: readonly string[]): AppConfig {
  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    host: env.API_HOST,
    port: env.API_PORT,
    logLevel: env.LOG_LEVEL,
    version,
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
    corsOrigins,
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
  const parsed = parseEnv(mergeEnv(process.env, derived.values))

  const issues: EnvIssue[] = [...derived.issues]
  if (!parsed.ok) issues.push(...parsed.issues)

  if (!parsed.ok || issues.length > 0) throw new EnvValidationError(issues)

  const { origins, invalid } = parseOriginList(parsed.env.CORS_ORIGINS)
  if (invalid.length > 0) {
    throw new EnvValidationError([
      { variable: 'CORS_ORIGINS', reason: 'http(s) 오리진 목록이어야 합니다' },
    ])
  }

  const version = parsed.env.API_VERSION ?? readPackageVersion() ?? UNKNOWN_VERSION

  return {
    config: toAppConfig(parsed.env, version, origins),
    sources: { envFiles, portOffset: derived.offset },
  }
}
