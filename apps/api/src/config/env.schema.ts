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

  /**
   * Upper bound on the connections one API process holds open.
   *
   * The deployed database is a free Neon instance (D-060), where connections —
   * not CPU — are the ceiling, so this is deliberately an operator knob rather
   * than something derived from the core count of whatever container the API
   * landed on. `pg`'s own default is 10, which is also a sane local value.
   */
  DATABASE_POOL_SIZE: z.coerce
    .number({ error: '1~100 사이의 정수여야 합니다' })
    .int({ error: '1~100 사이의 정수여야 합니다' })
    .min(1, { error: '1~100 사이의 정수여야 합니다' })
    .max(100, { error: '1~100 사이의 정수여야 합니다' })
    .default(10),

  /** `pg` waits forever by default; a suspended Neon compute must not hang a request. */
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce
    .number({ error: '100~60000 사이의 정수(밀리초)여야 합니다' })
    .int({ error: '100~60000 사이의 정수(밀리초)여야 합니다' })
    .min(100, { error: '100~60000 사이의 정수(밀리초)여야 합니다' })
    .max(60_000, { error: '100~60000 사이의 정수(밀리초)여야 합니다' })
    .default(5_000),

  DATABASE_HEALTH_TIMEOUT_MS: z.coerce
    .number({ error: '50~10000 사이의 정수(밀리초)여야 합니다' })
    .int({ error: '50~10000 사이의 정수(밀리초)여야 합니다' })
    .min(50, { error: '50~10000 사이의 정수(밀리초)여야 합니다' })
    .max(10_000, { error: '50~10000 사이의 정수(밀리초)여야 합니다' })
    .default(1_000),

  MEILI_HOST: z.url({
    protocol: /^https?$/,
    error: 'http:// 또는 https:// 로 시작하는 URL 이어야 합니다',
  }),

  MEILI_MASTER_KEY: z
    .string({ error: '값이 필요합니다' })
    .min(1, { error: '값이 필요합니다' })
    // No default on purpose: a fallback secret is a secret that reaches production.
    .refine((key) => key.length >= 8, { error: '8자 이상이어야 합니다' }),

  /**
   * Signs the access token (TASK-0022).
   *
   * **Required, unlike R2 and Google.** Those two answer 503 on one endpoint
   * while unconfigured, because the account they need is provisioned separately
   * from the code. Signing is not like that: without a secret every
   * authenticated request fails, and a process that boots into that state is
   * only useful for discovering the problem in production. Tests supply their
   * own through `testAppConfig`, so CI is unaffected.
   *
   * 32 characters, which is what `openssl rand -base64 32` produces once padded
   * — the same generator `render.yaml` already tells an operator to use for
   * `MEILI_MASTER_KEY`. Shorter than the 256-bit HMAC block is not an attack,
   * but it is almost always a placeholder somebody meant to replace.
   */
  JWT_SECRET: z
    .string({ error: '값이 필요합니다' })
    .min(1, { error: '값이 필요합니다' })
    .refine((key) => key.length >= 32, { error: '32자 이상이어야 합니다' }),

  MEILI_HEALTH_TIMEOUT_MS: z.coerce
    .number({ error: '50~10000 사이의 정수(밀리초)여야 합니다' })
    .int({ error: '50~10000 사이의 정수(밀리초)여야 합니다' })
    .min(50, { error: '50~10000 사이의 정수(밀리초)여야 합니다' })
    .max(10_000, { error: '50~10000 사이의 정수(밀리초)여야 합니다' })
    .default(1_500),

  /** Comma separated. Empty means "reject every cross origin request". */
  CORS_ORIGINS: z.string({ error: '쉼표로 구분된 오리진 목록이어야 합니다' }).default(''),

  /**
   * 결제 실패 재현 장치를 켠다 (TASK-0054 4.4 · F8 · R1).
   *
   * 켜면 가상 카드가 **승인 지연과 랜덤 거절**을 흉내 낸다. 그 둘은 시연 장치이지
   * 기능이 아니라서, 이 값이 없으면 그 코드 경로가 아예 없다.
   *
   * **한도 초과와 카드 정지는 이것과 무관하다.** 그쪽은 정상 기능이고 운영에서도
   * 일어나야 한다 — 오히려 그 둘만으로 실패 시연의 대부분이 된다.
   *
   * 기본값이 꺼짐인 것이 R1 의 답이다. 운영에 「깜빡하고 켜 둔」 상태가 존재하려면
   * 누군가 명시적으로 켜야 한다.
   */
  PAYMENT_SIMULATION: z
    .enum(['off', 'delay', 'timeout'], {
      error: "'off' · 'delay' · 'timeout' 중 하나여야 합니다",
    })
    .default('off'),
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
