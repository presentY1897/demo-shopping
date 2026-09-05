import { createHmac, timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

/**
 * 웹훅 수신의 순수 규칙과 상수 (TASK-0056).
 *
 * **이 파일의 전제 하나가 나머지를 정한다: 웹훅 본문을 믿지 않는다.** 도착한 것은
 * 「지금 확인해 보라」는 신호일 뿐이고, 상태를 정하는 것은 우리가 저쪽에 **다시
 * 물어본 답**이다 (`PaymentService.resolveUnresolved`).
 *
 * 그 선택이 F2(멱등)·F3(순서 역전)를 거의 공짜로 만든다.
 *
 * | 걱정 | 본문을 믿는 구현 | 다시 묻는 구현 |
 * | --- | --- | --- |
 * | 같은 웹훅 3회 | 이벤트 id 를 저장해 두고 두 번째부터 걸러야 한다 | 세 번 다 「지금 저쪽 상태」를 읽어 같은 결론에 닿는다 |
 * | 오래된 이벤트가 나중에 | 이벤트 시각을 상태 시각과 비교해야 한다 | 우리가 읽는 것은 그 이벤트가 아니라 **현재**다 |
 * | 위조된 본문 | 서명 + 본문 검증 둘 다 | 서명만 — 본문은 어차피 안 쓴다 |
 *
 * **그래서 이 파일에는 중복 판정이 없다.** 멱등 열쇠를 `PaymentEvent` 에 유니크
 * 컬럼으로 두는 안을 버린 이유는 두 가지다. 첫째, 중복이 무해하다 — 두 번째 웹훅도
 * 저쪽에 다시 묻고, 그 답이 같으므로 `resolveUnresolved` 가 `noop` 을 돌려준다.
 * 둘째, 유니크 컬럼은 **도착 기록을 지운다**: 두 번째 도착이 제약에 걸려 행을
 * 남기지 못하면 「몇 번 왔는가」에 답할 수 없게 되는데, 그것이야말로 분쟁에서 가장
 * 먼저 묻는 질문이다. 멱등은 「기록을 막는 것」이 아니라 **「상태를 한 번만 옮기는
 * 것」**이고, 그 보장은 이미 결제 행 잠금 아래 상태 검사가 쥐고 있다.
 */

/**
 * 라우트 — 전역 접두어(`/api`)와 버전(`/v1`)을 뺀 나머지.
 *
 * 상수인 이유는 **두 곳이 같은 경로를 알아야 하기 때문**이다. 컨트롤러가 라우트를
 * 열고, `configure-app.ts` 가 이 경로에만 원문 보존 미들웨어를 건다. 문자열을 두 번
 * 적으면 한쪽만 고쳐졌을 때 서명 검증이 빈 본문을 보게 되고, 그 증상은 「모든
 * 웹훅이 401」이라 원인이 서명 쪽으로 보인다.
 */
export const TOSS_WEBHOOK_ROUTE = 'payments/toss/webhook'

/**
 * 서명이 실려 오는 헤더.
 *
 * **우리가 정한 이름이다.** 토스 테스트 환경은 웹훅 시크릿을 발급하지 않아
 * (`.env.example` 참조) 서명 규약도 우리 것이다 — 실 계약이 생기면 결제사가 정한
 * 헤더 이름과 알고리즘으로 이 상수와 {@link signWebhook} 을 바꾸면 되고, 나머지는
 * 그대로다. 그것이 이 둘을 순수 함수로 떼어 둔 값이다.
 */
export const TOSS_WEBHOOK_SIGNATURE_HEADER = 'x-toss-signature'

/** 마지막 웹훅 수신 시각이 앉는 `AppMeta` 행. 헬스체크가 이것을 읽는다. */
export const WEBHOOK_LAST_RECEIVED_KEY = 'payment.webhook.lastReceivedAt'

/**
 * 받아 주는 본문의 상한.
 *
 * 서명 검증은 **본문 전체를 메모리에 들고** 해야 하므로(HMAC 이 그렇다) 상한이
 * 없으면 서명 없는 요청 하나로 프로세스를 밀어낼 수 있다 — 이 라우트는 인증 가드
 * 밖이라 그 요청을 아무나 보낼 수 있다. 결제 웹훅 본문은 1KB 남짓이고, 64KB 는
 * 그 예순 배다.
 */
export const MAX_WEBHOOK_BYTES = 64 * 1024

/**
 * 원문 바이트에 대한 HMAC-SHA256, 소문자 16진수.
 *
 * **문자열이 아니라 바이트에 건다.** 파싱한 뒤 다시 직렬화한 JSON 은 키 순서와
 * 공백이 달라져 다른 바이트열이 되고, 그러면 보낸 쪽과 받는 쪽이 서로 다른 것에
 * 서명하게 된다 — 서명이 「가끔」 틀리는, 가장 찾기 어려운 종류의 버그다.
 */
export function signWebhook(secret: string, body: Buffer): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

/**
 * 이 본문이 그 시크릿으로 서명된 것인가.
 *
 * **시크릿이 없으면 무조건 거짓이다** (`secret === null`). 검증할 수 없는 것을
 * 통과시키면 이 라우트는 「아무나 결제 상태를 흔들 수 있는 문」이 된다 — 그리고 그
 * 문은 인증 가드 밖에 있어 다른 방어선이 하나도 없다. 「키를 안 넣은 배포에서는
 * 웹훅이 그냥 동작한다」가 편해 보이지만, 그 편함의 대가가 결제다.
 *
 * **비교가 타이밍 안전해야 하는 이유**는 이것이 사실상 비밀번호 검사이기 때문이다.
 * 앞에서부터 한 바이트씩 끊어 비교하면 맞은 바이트 수에 따라 응답 시간이 달라지고,
 * 같은 본문을 여러 번 보내며 그 차이를 재면 서명을 한 바이트씩 알아낼 수 있다.
 *
 * 길이는 **`timingSafeEqual` 앞에서** 본다. 길이가 다르면 그 함수는 던지고, 던진
 * 예외는 500 이 되어 「우리가 깨졌다」로 읽힌다 — 실제로는 서명이 틀린 것뿐이다.
 */
export function hasValidSignature(
  secret: string | null,
  body: Buffer,
  signature: string | undefined,
): boolean {
  if (secret === null || signature === undefined) return false

  // 16진수 문자열을 그대로 바이트로 비교한다. `Buffer.from(hex, 'hex')` 로 되돌리면
  // 잘못된 문자를 조용히 버려서 **다른 서명이 같은 바이트가 되는** 짝이 생긴다.
  const expected = Buffer.from(signWebhook(secret, body), 'utf8')
  const actual = Buffer.from(signature.trim().toLowerCase(), 'utf8')

  if (expected.length !== actual.length) return false

  return timingSafeEqual(expected, actual)
}

/**
 * 본문을 JSON 으로 읽는다. 못 읽으면 `null`.
 *
 * 던지지 않는 이유는 부르는 쪽이 **읽지 못한 것과 우리 결제가 아닌 것을 다르게**
 * 다루기 때문이다 (`payment-webhook.service.ts`).
 */
export function parseWebhookBody(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    return null
  }
}

/** 웹훅이 가리키는 우리 결제. 둘 다 없으면 우리 것이 아니다. */
export interface WebhookReference {
  /**
   * 우리 `Payment.id`.
   *
   * 토스는 이 값을 **「주문번호」(`orderId`)** 라고 부른다 — 승인을 보낼 때 우리가
   * 거기에 결제 id 를 실었기 때문이다 (TASK-0055 4.3). 그래서 웹훅의 `orderId` 는
   * 우리 `Order.id` 가 아니다. 이 한 줄을 잘못 읽으면 남의 주문을 건드린다.
   */
  readonly paymentId: string | null
  /** 승인이 끝난 뒤의 웹훅에는 결제키가 있다. `orderId` 를 못 읽었을 때의 두 번째 열쇠다. */
  readonly paymentKey: string | null
}

const NOTHING: WebhookReference = { paymentId: null, paymentKey: null }

/**
 * 토스 웹훅 본문에서 **우리가 읽는 두 값만** 꺼낸다.
 *
 * 나머지 — `eventType`, `status`, 금액 — 는 일부러 읽지 않는다. 그 값들로 상태를
 * 정하는 순간 위조된 본문 하나가 결제를 옮길 수 있게 되고, 서명 검증이 유일한
 * 방어선이 된다. 우리가 본문에서 얻는 것은 **「어느 결제를 다시 물어볼까」** 하나다.
 *
 * 두 자리를 다 보는 것은 토스가 `data` 로 한 겹 싸는 모양과 싸지 않는 모양을 둘 다
 * 쓰기 때문이다. 없는 쪽은 `null` 이고, 그것도 정상적인 답이다.
 */
export function webhookReferenceOf(payload: unknown): WebhookReference {
  const parsed = webhookBodySchema.safeParse(payload)

  if (!parsed.success) return NOTHING

  const { data, orderId, paymentKey } = parsed.data

  return {
    paymentId: firstUuid(data?.orderId, orderId),
    paymentKey: firstText(data?.paymentKey, paymentKey),
  }
}

// ------------------------------------------------------------------ internals

/**
 * 두 자리를 모두 선택으로 둔 스키마.
 *
 * 엄격하게 쓰면 토스가 필드를 하나 더 붙이는 날 **모든 웹훅이 거부된다.** 우리가
 * 읽는 것은 두 값뿐이므로 나머지는 있든 없든 상관이 없어야 한다.
 */
const referenceFieldsSchema = z.object({
  orderId: z.string().optional(),
  paymentKey: z.string().optional(),
})

const webhookBodySchema = referenceFieldsSchema.extend({
  data: referenceFieldsSchema.optional(),
})

/**
 * 첫 번째로 **uuid 인** 값.
 *
 * uuid 인지 보는 것이 필수다. `Payment.id` 는 `uuid` 컬럼이라 아무 문자열로 조회하면
 * Postgres 가 던지고, 그 예외는 500 이 되어 PG 가 영원히 재전송한다 — 남의 웹훅
 * 하나가 우리 로그를 채우는 모양이다.
 */
function firstUuid(...values: readonly (string | undefined)[]): string | null {
  return values.find((value) => value !== undefined && z.uuid().safeParse(value).success) ?? null
}

/** 첫 번째로 비어 있지 않은 값. */
function firstText(...values: readonly (string | undefined)[]): string | null {
  return values.find((value) => value !== undefined && value.trim() !== '') ?? null
}
