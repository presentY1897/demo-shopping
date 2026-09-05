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
   * 토스 웹훅의 서명 시크릿 (TASK-0056 F4).
   *
   * **여기 있는 것이 `toss-config.ts` 에 있지 않은 이유는 개수다.** 저쪽 파일의
   * 두 키는 「둘 다 또는 하나도」라는 **집합의 규칙**이라 필드 검증 두 개로 표현할
   * 수 없다 — 하나만 채운 배포가 부팅에 성공해 버린다. 이것은 한 개짜리라 그런
   * 짝이 없고, 「있으면 유효해야 하고 없어도 된다」가 정확히 선택적 필드 하나다.
   * 규칙이 필드로 표현되는 한 그 규칙은 필드에 있어야 한다.
   *
   * **`TossConfig` 안에 넣지 않은 것도 같은 이유다.** 그 인터페이스의 필드는 전부
   * 필수라, 넣는 순간 「승인 키는 있는데 웹훅은 아직 안 붙인」 배포가 부팅하지
   * 못한다. 그것은 실제로 지나가는 단계이고(웹훅은 공개 URL 이 생긴 뒤에 등록한다),
   * 막을 이유가 없다.
   *
   * **없으면 웹훅 라우트가 모든 요청을 401 로 거절한다** (`payment-webhook.ts`).
   * R2·Google·토스 키가 「없으면 그 기능만 없다」인 것과 같은 성질이고, 다만 여기서
   * 「그 기능이 없다」의 모양이 라우트의 부재가 아니라 **전면 거절**이다 — 검증할 수
   * 없는 요청을 통과시키는 것이 그 반대편이라서다.
   *
   * 32자는 `JWT_SECRET` 과 같다. 짧은 것이 공격은 아니지만 거의 언제나 누군가
   * 바꾸려다 만 자리 표시자다. 빈 값으로 두면 부팅이 거부되는데, 그것도 의도다 —
   * `FOO=` 는 「설정하지 않았다」가 아니라 「설정하다 말았다」에 가깝다.
   */
  TOSS_WEBHOOK_SECRET: z
    .string({ error: '값이 필요합니다' })
    .min(1, { error: '값이 필요합니다' })
    .refine((key) => key.length >= 32, { error: '32자 이상이어야 합니다' })
    .optional(),

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

  /**
   * 발송된 주문이 배송완료와 구매확정까지 얼마나 빨리 가는가
   * (TASK-0062 4장 · TASK-0064).
   *
   * `demo` 는 배송이 단계당 2분(발송 → 배송완료 6분)이고 배송완료 5분 뒤 자동
   * 확정이며, `realistic` 은 단계당 4시간(12시간)에 배송완료 7일 뒤 확정이다.
   * 어느 쪽이든 **배송은 가상이다** — 이 값이 고르는 것은 장치를 켜고 끄는 것이
   * 아니라 **속도**이고, 그래서 `off` 가 없다.
   *
   * **한 축이 둘을 지배하는 것이 이름에 `DELIVERY` 가 없는 이유다.** 배송과
   * 구매확정이 각자의 스위치를 가지면 둘 중 하나만 켠 배포가 생기고, 그때 데모는
   * 「배송은 6분인데 확정은 7일」로 배송완료에서 끊긴다 — 그리고 아무것도
   * 실패하지 않는다.
   *
   * **기본값이 `demo` 인 것이 위 {@link PAYMENT_SIMULATION} 과 반대 방향인데,
   * 그것이 의도다.** 저쪽은 켜는 것이 실패라서 깜빡 켜 두면 운영이 깨지지만,
   * 이쪽은 잘못 두었을 때 조용한 쪽이 `realistic` 이다 — 배포된 데모에서 방문자가
   * 배송완료를 못 보고, 구매확정 · 정산 · 반품이 전부 닫히는데 **아무 요청도
   * 실패하지 않는다.** 잘못 뒀을 때 조용한 값을 기본값으로 두지 않는다.
   */
  FULFILLMENT_PACE: z
    .enum(['demo', 'realistic'], { error: "'demo' · 'realistic' 중 하나여야 합니다" })
    .default('demo'),
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
