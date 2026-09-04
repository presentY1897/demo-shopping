import { isBlank, isSet } from './env-value.js'
import type { EnvIssue } from './env.schema.js'

/**
 * Google OAuth credentials, resolved from the environment (TASK-0021 4장).
 *
 * Kept out of `env.schema.ts` for the same reason R2 is: the rule is not
 * per-variable. A client id without its secret is not a configuration with one
 * field missing, it is a deployment that will fail on the first sign-in — and
 * "both, or neither" cannot be stated as two independent field validations.
 *
 * The names are fixed by D-209 and are the ones already registered in the Google
 * console; they are not ours to choose.
 */
export interface GoogleOAuthConfig {
  readonly clientId: string
  readonly clientSecret: string
}

export interface GoogleOAuthResolution {
  /** `null` when neither variable is set — a supported state, not an error. */
  readonly config: GoogleOAuthConfig | null
  readonly issues: readonly EnvIssue[]
}

/** Both variables, so "neither of them" can be recognised. */
const VARIABLES = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const

type Source = Readonly<Record<string, string | undefined>>

/**
 * Reads the Google credentials, or reports why it cannot.
 *
 * | environment | result |
 * | --- | --- |
 * | neither set | `config: null`, no issues — the API boots, sign-in 503s |
 * | both set | a configuration |
 * | one set | issues, which the caller turns into a refusal to boot |
 *
 * **The first row is what keeps CI green.** `.github/workflows/ci.yml` injects
 * no Google secrets, so a required variable here would fail every job in the
 * repository rather than the one test that needs it. It is also what let the
 * API run for the two days between the Render deploy and the OAuth client being
 * created, and what will let it run again if the credentials are ever rotated
 * out from under a running deployment.
 *
 * **The third row is why this is not two optionals.** A deployment that set only
 * the id would boot, serve everything, and answer the first sign-in with a
 * failure from inside a token exchange — a support ticket whose cause is three
 * frames down. `storage-config.ts` made the same call for R2, and `derived-env`
 * made it for `CORS_ORIGINS`: a stopped process is cheaper than a wrong one.
 */
export function resolveGoogleOAuthConfig(source: Source): GoogleOAuthResolution {
  if (VARIABLES.every((variable) => isBlank(source[variable]))) {
    return { config: null, issues: [] }
  }

  const issues: EnvIssue[] = []

  for (const variable of VARIABLES) {
    // Never quotes the value: the secret half would end up in a boot log.
    if (isBlank(source[variable])) issues.push({ variable, reason: '설정되지 않았습니다' })
  }

  const clientId = source.GOOGLE_CLIENT_ID
  const clientSecret = source.GOOGLE_CLIENT_SECRET

  // Re-tested rather than inferred from `issues.length`: the compiler cannot
  // follow that, and satisfying it with `?? ''` would add a fallback no input
  // can reach.
  if (isSet(clientId) && isSet(clientSecret)) return { config: { clientId, clientSecret }, issues }

  return { config: null, issues }
}
