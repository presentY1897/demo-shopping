import type { AppOrigins } from './app-origins.js'
import type { GoogleOAuthConfig } from './google-config.js'
import type { TossConfig } from './toss-config.js'
import type { ObjectStorageConfig } from './storage-config.js'

/** Injection token for {@link AppConfig}; the object itself has no class to key on. */
export const APP_CONFIG = Symbol('APP_CONFIG')

export type NodeEnv = 'development' | 'test' | 'production'

export type LogLevel = 'error' | 'warn' | 'log' | 'debug' | 'verbose'

/**
 * The validated configuration of one API process.
 *
 * Everything the application reads from the environment passes through here,
 * so `process.env` is never touched outside of `src/config`. That is what makes
 * a missing variable a boot failure instead of an `undefined` surfacing days
 * later inside a request handler.
 */
export interface AppConfig {
  readonly nodeEnv: NodeEnv
  readonly isProduction: boolean
  /** Interface to bind to. `0.0.0.0` so that a container publishes correctly. */
  readonly host: string
  readonly port: number
  readonly logLevel: LogLevel
  /** Reported by `GET /api/v1/health` and by the `X-Api-Version` header. */
  readonly version: string
  readonly database: {
    readonly url: string
    /** Maximum connections this process holds open. See `DATABASE_POOL_SIZE`. */
    readonly poolSize: number
    /** Deadline for acquiring a connection from the pool. */
    readonly connectTimeoutMs: number
    /** Deadline for the `/health` probe query. */
    readonly healthTimeoutMs: number
  }
  readonly search: {
    readonly host: string
    readonly masterKey: string
    readonly timeoutMs: number
    /**
     * Which index the catalogue lives in.
     *
     * Configurable for one reason: **tests**. The database harness gives each
     * vitest worker its own database, and two specs that shared one index would
     * clear each other's documents mid-assertion the same way two specs sharing
     * a database would — measured, when they did exactly that. Production has
     * one value and always will.
     */
    readonly productsIndex: string
  }
  /**
   * Object storage for uploaded images, or `null` while R2 is not configured.
   *
   * Nullable rather than required because the account is provisioned separately
   * from the code: the API has to run — and every other endpoint has to work —
   * before a bucket exists. The upload endpoint answers 503 until it does
   * (TASK-0011 4.5).
   */
  readonly storage: ObjectStorageConfig | null
  /**
   * Google OAuth credentials, or `null` while they are not configured.
   *
   * Nullable for the same reason `storage` is, plus one more: CI injects no
   * Google secrets, so a required value here would fail every job in the
   * repository. Sign-in answers 503 until it is set (TASK-0021 4장).
   */
  readonly googleOAuth: GoogleOAuthConfig | null
  /**
   * 토스페이먼츠 자격증명, 또는 설정되지 않았으면 `null` (TASK-0055 4.1).
   *
   * `null` 이면 `TossProvider` 가 레지스트리에 **등록되지 않는다** — 결제수단
   * 목록에 나오지 않고, 가상 카드만으로 전체 흐름이 완결된다 (D-031). 자격증명이
   * 없으면 그 기능만 없는 것이 이 저장소가 R2·Google 에서 이미 두 번 산 성질이다.
   */
  readonly toss: TossConfig | null
  /**
   * 토스 웹훅의 서명 시크릿, 또는 설정되지 않았으면 `null` (TASK-0056 F4).
   *
   * {@link toss} 와 **따로 있다.** 저 둘은 한 쌍이라 함께 오지만 이것은 한 개이고,
   * 승인 키가 있는 배포가 웹훅을 아직 등록하지 않은 상태는 정상이다 — 웹훅 URL 은
   * 공개 주소가 생긴 뒤에 결제사 콘솔에 등록한다.
   *
   * `null` 이면 웹훅 라우트가 **모든 요청을 401 로 거절한다.** 다른 선택지 —
   * 검증 없이 통과 — 는 아무나 결제 상태를 흔들 수 있는 문을 여는 것이고, 그 문은
   * 인증 가드 밖이라 뒤에 아무것도 없다.
   */
  readonly tossWebhookSecret: string | null
  /**
   * Secrets and lifetimes for sessions (TASK-0022).
   *
   * Not nullable, unlike {@link storage} and {@link googleOAuth}: a process
   * that cannot sign a token cannot serve an authenticated request at all, so
   * "unconfigured" is a boot failure rather than one endpoint answering 503.
   */
  readonly auth: {
    readonly jwtSecret: string
    /** Access token lifetime. Short: there is no revocation list (R4). */
    readonly accessTokenTtlSeconds: number
    /** Refresh token lifetime, matching the cookie's `Max-Age`. */
    readonly refreshTokenTtlSeconds: number
  }
  /** Exact origins allowed by CORS. Anything else is rejected. */
  readonly corsOrigins: readonly string[]
  /**
   * Which of {@link corsOrigins} belongs to which app.
   *
   * Derived rather than configured: the OAuth callback redirects to one of
   * these, and picking from the list the operator already vetted is what makes
   * an open redirect unrepresentable (`app-origins.ts`).
   */
  readonly appOrigins: AppOrigins
  /**
   * 결제 실패 재현 장치 (TASK-0054 4.4 · 4.5).
   *
   * | 값 | 무엇이 일어나나 |
   * | --- | --- |
   * | `off` | 아무 장치도 없다. 운영의 값이다 |
   * | `delay` | 승인이 늦게 끝난다. 그러나 **끝난다** (F4) |
   * | `timeout` | 승인이 마감을 넘겨 **프로바이더가 스스로 끊는다** (F5) |
   *
   * 지연과 타임아웃이 **다른 값**인 것이 4.5 다. 지연을 아주 길게 잡는 것으로
   * 타임아웃을 흉내 내면 재는 것이 프로바이더가 아니라 검사의 인내심이 된다.
   *
   * 한도 초과와 카드 정지는 이 값과 무관하게 언제나 일어난다 — 그쪽은 시연 장치가
   * 아니라 정상 기능이고, 운영에서도 일어나야 한다.
   */
  readonly paymentSimulation: PaymentSimulation
  /**
   * 발송된 주문이 배송완료와 구매확정까지 얼마나 빨리 가는가
   * (TASK-0062 4장 · TASK-0064).
   *
   * | 값 | 배송 단계 간격 | 발송 → 배송완료 | 배송완료 → 자동 확정 |
   * | --- | --- | --- | --- |
   * | `demo` | 2분 | 6분 | 5분 |
   * | `realistic` | 4시간 | 12시간 | 7일 |
   *
   * **두 기능이 축을 나눠 갖는 것이 이 필드의 이름이 `delivery` 가 아닌 이유다.**
   * 배송과 구매확정이 각자의 스위치를 가지면 둘 중 하나만 켠 배포가 생기고, 그때
   * 데모는 배송완료에서 끊긴다 — 그리고 아무것도 실패하지 않는다. 값이 뜻하는
   * 시간은 각자 갖는다: 배송은 `shipping/delivery-simulator.ts`, 확정은
   * `orders/order-confirm.ts` 다.
   *
   * **{@link paymentSimulation} 과 다른 종류의 값이다.** 저것은 재현 장치를
   * 켜고 끄므로 `off` 가 있고 기본값이 `off` 다 — 켜는 것이 **실패**라서 깜빡
   * 켜 두면 운영에서 결제가 깨진다. 이쪽은 켜고 끄는 것이 아니라 **속도**를
   * 고른다: 배송은 어느 값에서도 가상이고(CLAUDE.md 5장), 두 값 모두 같은 사건을
   * 같은 순서로 만든다.
   *
   * 그래서 기본값의 방향도 반대다. 여기서 잘못 두었을 때 조용한 쪽은
   * `realistic` 이다 — 배포된 데모에서 배송완료가 영영 오지 않는데 **아무것도
   * 실패하지 않는다.** 잘못 뒀을 때 조용한 값을 기본값으로 두지 않는다.
   *
   * 왜 데모 계정 판정이나 `PAYMENT_SIMULATION` 을 쓰지 않았는지는
   * `shipping/delivery-simulator.ts` 의 `DELIVERY_STEP_MS` 에 표로 적혀 있다.
   */
  readonly fulfillmentPace: FulfillmentPace
}

/** 결제 실패 재현의 세 가지 모드. */
export type PaymentSimulation = 'off' | 'delay' | 'timeout'

/** 이행 속도의 두 가지 모드. 시간의 실제 값은 배송·확정이 각자 쥔다. */
export type FulfillmentPace = 'demo' | 'realistic'
