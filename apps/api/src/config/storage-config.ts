import { isBlank, firstSet } from './env-value.js'
import type { EnvIssue } from './env.schema.js'

/**
 * Where uploaded objects go, resolved from the environment (TASK-0011 4.5).
 *
 * Kept out of `env.schema.ts` because the rule is not per-variable: R2 is
 * configured *as a set*, and the interesting cases — none of it set, all of it
 * set, half of it set — cannot be stated as six independent field validations.
 *
 * The endpoint is S3-compatible rather than R2-specific on purpose. R2's API is
 * S3's, so the same configuration points at a local MinIO for the round-trip
 * check (`scripts/verify-presign-roundtrip.mjs`) without a second code path.
 */
export interface ObjectStorageConfig {
  /** Origin of the S3 API, e.g. `https://<account>.r2.cloudflarestorage.com`. */
  readonly endpoint: string
  readonly bucket: string
  /** `auto` for R2. */
  readonly region: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  /** Origin objects are publicly readable from, without a trailing slash. */
  readonly publicBaseUrl: string
}

export interface ObjectStorageResolution {
  /** `null` when no R2 variable is set at all — a supported state, not an error. */
  readonly config: ObjectStorageConfig | null
  readonly issues: readonly EnvIssue[]
}

/** Every variable that participates, so "none of them" can be recognised. */
const VARIABLES = [
  'R2_ACCOUNT_ID',
  'R2_ENDPOINT',
  'R2_BUCKET',
  'R2_REGION',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_PUBLIC_BASE_URL',
] as const

/** R2 calls it `auto`; the value is signed into the URL and must match. */
const DEFAULT_REGION = 'auto'

/**
 * The account id appears in a hostname, so it has to be a valid label.
 *
 * Cloudflare's is 32 hex characters, but pinning the length here would make a
 * future format change look like a configuration error.
 */
const ACCOUNT_ID = /^[a-z0-9]{4,64}$/

/** S3 bucket naming, which R2 follows: lowercase, no underscores, 3–63 chars. */
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/

const REGION = /^[a-z0-9-]{1,32}$/

type Source = Readonly<Record<string, string | undefined>>

/**
 * The origin of an http(s) URL that is *only* an origin.
 *
 * A path is refused rather than dropped. Both of these variables name a place
 * objects live, and quietly discarding `/images` from a public base URL would
 * produce links that 404 while the configuration looked accepted.
 */
function httpOrigin(value: string): string | null {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return null

  return url.origin
}

/**
 * Collects issues so a bad environment reports all of its problems at once.
 *
 * A failed lookup answers `''` rather than `null`, and the caller checks
 * {@link Issues.entries} once instead of re-testing every field. The alternative
 * — a nullable per field plus a combined guard — leaves branches that no input
 * can reach, since a `null` and a recorded issue always arrive together.
 */
class Issues {
  readonly entries: EnvIssue[] = []

  add(variable: string, reason: string): void {
    this.entries.push({ variable, reason })
  }

  /** The value, or `''` with an issue recorded. Never quotes the value. */
  require(source: Source, variable: string, pattern?: RegExp): string {
    const value = source[variable] ?? ''

    if (isBlank(value)) {
      this.add(variable, '설정되지 않았습니다')
      return ''
    }
    if (pattern !== undefined && !pattern.test(value)) {
      this.add(variable, '형식이 올바르지 않습니다')
      return ''
    }

    return value
  }

  requireOrigin(source: Source, variable: string): string {
    const origin = httpOrigin(this.require(source, variable))

    if (origin === null) {
      // Nothing to say twice when the value was simply absent.
      if (!isBlank(source[variable])) {
        this.add(variable, '경로 없는 http(s) 오리진이어야 합니다')
      }
      return ''
    }

    return origin
  }
}

/**
 * The endpoint, from an explicit override or derived from the account id.
 *
 * `R2_ENDPOINT` wins when both are set, following the same rule as everything
 * else in this directory: what an operator wrote down beats what we derived. It
 * is also what points the round-trip script at a local MinIO.
 */
function resolveEndpoint(source: Source, issues: Issues): string {
  if (!isBlank(source.R2_ENDPOINT)) return issues.requireOrigin(source, 'R2_ENDPOINT')

  const accountId = issues.require(source, 'R2_ACCOUNT_ID', ACCOUNT_ID)

  return accountId === '' ? '' : `https://${accountId}.r2.cloudflarestorage.com`
}

/**
 * Reads the object storage configuration, or reports why it cannot.
 *
 * Three outcomes, and the middle one is the point:
 *
 * | environment | result |
 * | --- | --- |
 * | no R2 variable set | `config: null`, no issues — the API boots, presign 503s |
 * | all of them set | a configuration |
 * | some of them set | issues, which the caller turns into a refusal to boot |
 *
 * A half-configured deployment must not start. `derived-env.ts` made the same
 * call about `CORS_ORIGINS`: a missing value that silently falls back is worse
 * than a stopped process, because "images do not upload" is a support ticket
 * while "images upload into the wrong bucket" is not noticed at all.
 */
export function resolveObjectStorageConfig(source: Source): ObjectStorageResolution {
  if (VARIABLES.every((variable) => isBlank(source[variable]))) {
    return { config: null, issues: [] }
  }

  const issues = new Issues()
  const endpoint = resolveEndpoint(source, issues)
  const bucket = issues.require(source, 'R2_BUCKET', BUCKET)
  const accessKeyId = issues.require(source, 'R2_ACCESS_KEY_ID')
  const secretAccessKey = issues.require(source, 'R2_SECRET_ACCESS_KEY')
  const publicBaseUrl = issues.requireOrigin(source, 'R2_PUBLIC_BASE_URL')
  const region = firstSet(source.R2_REGION) ?? DEFAULT_REGION

  if (!REGION.test(region)) issues.add('R2_REGION', '형식이 올바르지 않습니다')

  if (issues.entries.length > 0) return { config: null, issues: issues.entries }

  return {
    config: { endpoint, bucket, region, accessKeyId, secretAccessKey, publicBaseUrl },
    issues: [],
  }
}
