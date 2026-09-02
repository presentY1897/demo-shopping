import { z } from 'zod'

import { isBlank } from './env-value.js'

/**
 * Shape of the process environment after {@link mergeEnv} has filled in the
 * values derived from `PORT_OFFSET`.
 *
 * Every message is written here rather than left to zod's defaults for two
 * reasons: the operator reading a failed boot deserves Korean, and a generated
 * message must never quote the offending value — half of these variables are
 * credentials.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'], {
      error: 'development · test · production 중 하나여야 합니다',
    })
    .default('development'),

  API_HOST: z.string({ error: '문자열이어야 합니다' }).min(1).default('0.0.0.0'),

  API_PORT: z.coerce
    .number({ error: '1~65535 사이의 정수여야 합니다' })
    .int({ error: '1~65535 사이의 정수여야 합니다' })
    .min(1, { error: '1~65535 사이의 정수여야 합니다' })
    .max(65535, { error: '1~65535 사이의 정수여야 합니다' }),

  LOG_LEVEL: z
    .enum(['error', 'warn', 'log', 'debug', 'verbose'], {
      error: 'error · warn · log · debug · verbose 중 하나여야 합니다',
    })
    .default('log'),

  API_VERSION: z.string({ error: '문자열이어야 합니다' }).min(1).optional(),

  DATABASE_URL: z.url({
    error: 'postgresql://user:password@host:port/db 형식의 URL 이어야 합니다',
  }),

  MEILI_HOST: z.url({
    protocol: /^https?$/,
    error: 'http:// 또는 https:// 로 시작하는 URL 이어야 합니다',
  }),

  MEILI_MASTER_KEY: z
    .string({ error: '값이 필요합니다' })
    .min(1, { error: '값이 필요합니다' })
    // No default on purpose: a fallback secret is a secret that reaches production.
    .refine((key) => key.length >= 8, { error: '8자 이상이어야 합니다' }),

  MEILI_HEALTH_TIMEOUT_MS: z.coerce
    .number({ error: '50~10000 사이의 정수(밀리초)여야 합니다' })
    .int({ error: '50~10000 사이의 정수(밀리초)여야 합니다' })
    .min(50, { error: '50~10000 사이의 정수(밀리초)여야 합니다' })
    .max(10_000, { error: '50~10000 사이의 정수(밀리초)여야 합니다' })
    .default(1_500),

  /** Comma separated. Empty means "reject every cross origin request". */
  CORS_ORIGINS: z.string({ error: '쉼표로 구분된 오리진 목록이어야 합니다' }).default(''),
})

export type Env = z.infer<typeof envSchema>

/** One environment variable that failed validation. Never carries its value. */
export interface EnvIssue {
  readonly variable: string
  readonly reason: string
}

export type EnvParseResult =
  | { readonly ok: true; readonly env: Env }
  | { readonly ok: false; readonly issues: readonly EnvIssue[] }

/**
 * Validates the merged environment.
 *
 * Takes a plain record instead of reading `process.env` so that the rules can be
 * unit tested without mutating the test runner's own environment.
 */
export function parseEnv(source: Readonly<Record<string, string | undefined>>): EnvParseResult {
  const result = envSchema.safeParse(source)
  if (result.success) return { ok: true, env: result.data }

  const seen = new Set<string>()
  const issues: EnvIssue[] = []

  for (const issue of result.error.issues) {
    const variable = issue.path.map(String).join('.')
    if (seen.has(variable)) continue
    seen.add(variable)

    issues.push({
      variable,
      reason: isBlank(source[variable]) ? '설정되지 않았습니다' : issue.message,
    })
  }

  return { ok: false, issues }
}
