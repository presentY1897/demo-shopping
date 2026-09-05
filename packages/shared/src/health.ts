import { z } from 'zod'

/**
 * Liveness of the API itself or of one of its dependencies.
 *
 * - `ok` — reachable and answering within the timeout
 * - `degraded` — reachable but answering something unexpected
 * - `down` — unreachable, or answering with an error
 */
export const healthStatusSchema = z.enum(['ok', 'degraded', 'down'])

export type HealthStatus = z.infer<typeof healthStatusSchema>

/**
 * What `GET /api/v1/health` weighs when it decides the overall `status`.
 *
 * Adding one is a three step change: append the key here, add the field to
 * `healthResponseSchema`, and register an indicator in the API's health module.
 *
 * Mostly these are external systems the API talks to, and their field is a bare
 * {@link HealthStatus}. `reservationExpiry` is neither: it is the API's own
 * sweeper, and its field carries numbers alongside the status. It earns a key
 * here anyway, because the test is not "is it something we call" — it is
 * "does the API keep a promise it cannot keep while this is broken".
 */
export const healthDependencyKeys = [
  'database',
  'search',
  'reservationExpiry',
  'paymentReconcile',
  'paymentStraggler',
] as const

export type HealthDependencyKey = (typeof healthDependencyKeys)[number]

/**
 * Payload of `GET /api/v1/health`.
 *
 * `status` describes the API as a whole: it is `ok` only while every dependency
 * is `ok`, and `degraded` as soon as one is not. The endpoint answers 200 in
 * both cases — a search or database outage must not make the API look dead to a
 * load balancer that would then stop routing traffic to it.
 */
export const healthResponseSchema = z.object({
  status: healthStatusSchema,
  database: healthStatusSchema,
  search: healthStatusSchema,
  /** Seconds since the API process started. */
  uptime: z.number().nonnegative(),
  /** Version of the deployed API build. */
  version: z.string().min(1),
  /**
   * When the demo cleanup sweep last finished (TASK-0025 F5).
   *
   * `null` before the first run of a freshly started API, which is a real state
   * and not a failure — the sweep runs on an interval, not at boot.
   *
   * **Not a `HealthDependencyKey`.** The dependency keys are things the API
   * talks to and whose absence makes it unable to answer; a sweep that has not
   * run yet does not stop a single request. What it stops is demo data being
   * collected, and the way to notice that is a timestamp going stale — so the
   * timestamp is what is published, and the judgement is left to whoever reads
   * it (요구사항 「스케줄러가 멈추면 헬스체크로 알 수 있다」).
   */
  demoCleanup: z.object({ lastRunAt: z.iso.datetime().nullable() }),
  /**
   * The search index queue (TASK-0038 F7).
   *
   * `pending` is how many product changes have not reached the index yet, and
   * `lastRunAt` is when the worker last applied any. Together they are the
   * answer to "검색이 왜 옛날 것을 보여주나": a pending count that is not falling
   * is a stopped worker, and a falling one is a busy one.
   *
   * Not a `HealthDependencyKey` either — `search` already is one, and it reports
   * the *engine*. This reports the pipeline that feeds it, which can be behind
   * while the engine is perfectly healthy.
   */
  searchIndex: z.object({
    pending: z.int().min(0),
    lastRunAt: z.iso.datetime().nullable(),
    /** When the oldest waiting change was queued. `null` when nothing waits. */
    oldestPendingAt: z.iso.datetime().nullable(),
  }),
  /**
   * 만료 예약 청소기 (TASK-0051 F5 · F6).
   *
   * **이 스케줄러가 멈추면 재고가 잠긴다.** 잡아 둔 재고가 영영 풀리지 않고, 아무도
   * 그것을 살 수 없으며, **아무것도 실패하지 않는다** — 주문도 결제도 에러를 내지
   * 않는다. 그 침묵을 밖으로 꺼낼 자리가 여기밖에 없어서 이 필드가 있다.
   *
   * 그래서 위의 두 필드와 달리 `status` 를 품는다. `demoCleanup` 은 시각만 싣고
   * 판단을 읽는 쪽에 맡기지만 — 데모 청소가 밀려도 요청 하나 막히지 않는다 —
   * 여기서는 반대다. 이 값은 {@link healthDependencyKeys} 의 하나이고, `degraded`
   * 는 맨 위의 `status` 까지 함께 내린다.
   *
   * `lastRunAt` 의 `null` 은 「아직 한 번도 안 돌았다」와 「행을 읽지 못했다」를 함께
   * 뜻하고, 둘 다 멈춘 것으로 친다 — 재고가 잠겨 있을지 모르는 상태에서 안전한
   * 해석은 그쪽이다. `releasedCount` 는 **마지막 한 번**이 푼 예약 수라서, 0 은
   * 「풀 것이 없었다」이지 「안 돌았다」가 아니다.
   *
   * **필수다.** API 는 언제나 이 키를 답한다 — 스케줄러가 안 돌았어도 「안 돌았다」를
   * 답한다. 선택으로 두면 읽는 쪽이 「필드가 없다」와 「멈췄다」를 구분해야 하는데,
   * 그 둘은 같은 뜻이면서 분기만 하나 늘린다. 그리고 **없는 경우를 허용하면 그것이
   * 정상인 줄 알고 지나간다** — 헬스체크가 잡아야 하는 것이 정확히 그 침묵이다.
   */
  reservationExpiry: z.object({
    status: healthStatusSchema,
    lastRunAt: z.iso.datetime().nullable(),
    releasedCount: z.int().min(0),
  }),
  /**
   * 결제 대사 배치 (TASK-0056 F6 · D-220).
   *
   * **이 배치가 멈추면 사람이 갇힌다.** 결제사에 닿지 못한 승인은 `UNRESOLVED` 로
   * 남고 거기서 나가는 길은 대사만 연다 — 그동안 그 주문에는 새 결제를 시작할 수
   * 없다. 카드에서 돈이 빠졌는지도 모르는 채로 다시 결제할 수도 없는 사람이
   * 남는데, **아무 요청도 실패하지 않는다.** 위의 `reservationExpiry` 와 같은
   * 종류의 침묵이고, 그래서 같은 모양으로 `status` 를 품는다 —
   * {@link healthDependencyKeys} 의 하나이고 `degraded` 는 맨 위의 `status` 까지
   * 함께 내린다.
   *
   * `resolvedCount` 는 **마지막 한 번**이 승인 또는 실패로 확정한 결제의 수다.
   * 저쪽도 아직 모르는 건과 웹훅이 먼저 처리한 건은 여기 들어오지 않는다 — 둘 다
   * 정상이지만 대사가 옮긴 것은 아니고, 섞으면 이 숫자가 「대사가 일하고 있다」의
   * 근거가 되지 못한다. 평소 값이 0 인 것이 정상이다: 이 상태 자체가 결제사에
   * 닿지 못했을 때만 생긴다.
   */
  paymentReconcile: z.object({
    status: healthStatusSchema,
    lastRunAt: z.iso.datetime().nullable(),
    resolvedCount: z.int().min(0),
  }),
  /**
   * 낙오된 결제를 끝내는 배치 (TASK-0057 F2 · F6 · D-221).
   *
   * **이 배치가 멈추면 두 종류의 사람이 조용히 갇힌다.** 매입은 끝났는데 주문이
   * 완료되지 않은 건은 「돈은 받았고 물건은 안 움직이는」 주문으로 남고, 매입 없이
   * 남은 승인은 그 사람의 카드 한도를 영영 물고 있다. 어느 쪽도 요청 하나 실패
   * 시키지 않는다 — 위의 두 필드와 같은 종류의 침묵이고, 그래서 같은 모양으로
   * `status` 를 품는다. {@link healthDependencyKeys} 의 하나이고 `degraded` 는
   * 맨 위의 `status` 까지 함께 내린다.
   *
   * `fixedCount` 는 **마지막 한 번**이 실제로 끝낸 결제의 수다 — 주문을 마저
   * 완료시킨 건과 승인을 취소한 건의 합이다. 취소하려는 사이에 사람이 돌아와
   * 매입을 마친 건은 여기 들어오지 않는다: 좋은 결과이지만 배치가 한 일이 아니고,
   * 섞으면 이 숫자가 「배치가 일하고 있다」의 근거가 되지 못한다. 평소 값이 0 인
   * 것이 정상이다 — 두 상태 모두 프로세스가 중간에 죽거나 사람이 결제창을 떠나야
   * 생긴다.
   */
  paymentStraggler: z.object({
    status: healthStatusSchema,
    lastRunAt: z.iso.datetime().nullable(),
    fixedCount: z.int().min(0),
  }),
  /**
   * 마지막으로 받은 결제 웹훅의 시각 (TASK-0056 2장).
   *
   * **`demoCleanup` 쪽이지 `paymentReconcile` 쪽이 아니다** — 시각만 싣고 판단은
   * 읽는 쪽에 맡긴다. 웹훅이 한 건도 오지 않은 것은 고장이 아니라 **평범한 상태**라서
   * 그렇다: 결제사 키가 없는 배포, 웹훅 URL 을 아직 등록하지 않은 배포, 그리고 그냥
   * 아무도 결제하지 않은 한 시간이 전부 여기 해당한다. 그것을 `degraded` 로 올리면
   * 헬스체크는 늘 빨갛고, 늘 빨간 헬스체크는 아무도 보지 않는다.
   *
   * 그러면 웹훅이 **끊긴** 것은 누가 아는가 — 대사 배치가 안다. 웹훅을 놓쳐도
   * 상태를 맞추는 것이 그쪽의 일이고, 그것이 멈춘 것은 위의 `paymentReconcile` 이
   * 판정한다. 여기서 같은 판정을 한 번 더 내리면 두 곳이 조용히 어긋난다.
   *
   * `null` 은 「이 프로세스가 뜬 뒤로 한 건도 안 왔다」가 아니라 **「기록이 없다」**
   * 이다 — 값이 `AppMeta` 에 있어 재시작을 넘겨 살아남기 때문이고, 그래서 배포
   * 직후에도 어제 받은 시각이 그대로 보인다. 「웹훅이 언제부터 끊겼나」를 물을 수
   * 있는 자리가 그 성질이다.
   */
  paymentWebhook: z.object({ lastReceivedAt: z.iso.datetime().nullable() }),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>
