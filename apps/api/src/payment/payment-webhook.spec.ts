import { describe, expect, it } from 'vitest'

import {
  hasValidSignature,
  parseWebhookBody,
  signWebhook,
  webhookReferenceOf,
} from './payment-webhook.js'

/**
 * 웹훅 수신의 순수 규칙 (TASK-0056, Q5 강화).
 *
 * **여기 있는 것은 데이터베이스도 HTTP 도 필요 없는 판단들뿐이다** — 서명이 맞는가,
 * 본문에서 어느 결제를 가리키는가. 나머지(원문 보존·멱등·순서 역전)는 실제 상태가
 * 걸린 문제라 `test/api/payment-webhook.spec.ts` 가 실 DB 로 잰다.
 *
 * 이 파일이 특히 신경 쓰는 것은 **거절하는 갈래**다. 서명 검증은 통과가 아니라
 * 거절이 본업이고, 통과만 재는 스펙은 「언제나 참을 돌려주는 구현」도 통과시킨다.
 */

const SECRET = 'webhook-secret-0000000000000000000000'
const BODY = Buffer.from('{"eventType":"PAYMENT_STATUS_CHANGED"}', 'utf8')

describe('signWebhook', () => {
  it('is a 64 character lower case hex digest', () => {
    expect(signWebhook(SECRET, BODY)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when a single byte of the body changes', () => {
    const altered = Buffer.from('{"eventType":"PAYMENT_STATUS_CHANGEE"}', 'utf8')

    expect(signWebhook(SECRET, altered)).not.toBe(signWebhook(SECRET, BODY))
  })

  it('changes when the secret changes', () => {
    expect(signWebhook(`${SECRET}x`, BODY)).not.toBe(signWebhook(SECRET, BODY))
  })

  it('signs the bytes, not a re-serialised object', () => {
    // 같은 JSON 이라도 공백과 키 순서가 다르면 다른 바이트열이다. 파싱 뒤 다시
    // 직렬화해 서명하는 구현은 이 두 값을 같게 만들고, 그러면 보낸 쪽과 받는 쪽이
    // 서로 다른 것에 서명하게 된다.
    const spaced = Buffer.from('{ "eventType": "PAYMENT_STATUS_CHANGED" }', 'utf8')

    expect(signWebhook(SECRET, spaced)).not.toBe(signWebhook(SECRET, BODY))
  })
})

describe('hasValidSignature', () => {
  it('accepts the signature it produced', () => {
    expect(hasValidSignature(SECRET, BODY, signWebhook(SECRET, BODY))).toBe(true)
  })

  it('accepts an upper case hex signature', () => {
    // 16진수의 대소문자는 뜻이 없다. 보내는 쪽 구현에 따라 갈리는 자리라, 여기서
    // 거절하면 「가끔 401」이 되고 그 원인은 로그에 드러나지 않는다.
    expect(hasValidSignature(SECRET, BODY, signWebhook(SECRET, BODY).toUpperCase())).toBe(true)
  })

  it('refuses a tampered signature of the right length', () => {
    const signature = signWebhook(SECRET, BODY)
    const flipped = `${signature.slice(0, -1)}${signature.endsWith('a') ? 'b' : 'a'}`

    expect(hasValidSignature(SECRET, BODY, flipped)).toBe(false)
  })

  it('refuses a signature of a different length instead of throwing', () => {
    // `timingSafeEqual` 은 길이가 다르면 던진다. 그 예외가 새어 나가면 500 이 되고,
    // 「우리가 깨졌다」로 읽히는 것은 실제로는 서명이 틀린 요청 하나다.
    expect(() => hasValidSignature(SECRET, BODY, 'short')).not.toThrow()
    expect(hasValidSignature(SECRET, BODY, 'short')).toBe(false)
  })

  it('refuses a body that was signed with another secret', () => {
    expect(
      hasValidSignature(SECRET, BODY, signWebhook('another-secret-000000000000000000', BODY)),
    ).toBe(false)
  })

  it('refuses a request with no signature at all', () => {
    expect(hasValidSignature(SECRET, BODY, undefined)).toBe(false)
  })

  it('refuses everything when no secret is configured', () => {
    // **이 줄이 F4 의 절반이다.** 검증할 수 없는 것을 통과시키면 이 라우트는 아무나
    // 결제 상태를 흔들 수 있는 문이 되고, 인증 가드 밖이라 뒤에 아무것도 없다.
    expect(hasValidSignature(null, BODY, signWebhook(SECRET, BODY))).toBe(false)
    expect(hasValidSignature(null, BODY, undefined)).toBe(false)
  })
})

describe('parseWebhookBody', () => {
  it('reads a JSON object', () => {
    expect(parseWebhookBody(Buffer.from('{"a":1}', 'utf8'))).toEqual({ a: 1 })
  })

  it('answers null for a body that is not JSON, rather than throwing', () => {
    expect(parseWebhookBody(Buffer.from('not json', 'utf8'))).toBeNull()
  })

  it('answers null for an empty body', () => {
    expect(parseWebhookBody(Buffer.alloc(0))).toBeNull()
  })
})

describe('webhookReferenceOf', () => {
  const PAYMENT_ID = '01999a4e-0000-7000-8000-000000000001'

  it('reads the payment id out of the nested data object', () => {
    // 토스가 「주문번호」라 부르는 자리에 우리 `Payment.id` 가 실려 있다 —
    // 승인을 보낼 때 우리가 거기 넣었기 때문이다 (TASK-0055 4.3).
    expect(webhookReferenceOf({ data: { orderId: PAYMENT_ID, paymentKey: 'key-1' } })).toEqual({
      paymentId: PAYMENT_ID,
      paymentKey: 'key-1',
    })
  })

  it('reads them from the top level when there is no data envelope', () => {
    expect(webhookReferenceOf({ orderId: PAYMENT_ID, paymentKey: 'key-1' })).toEqual({
      paymentId: PAYMENT_ID,
      paymentKey: 'key-1',
    })
  })

  it('prefers the nested values over the top level ones', () => {
    const other = '01999a4e-0000-7000-8000-000000000002'

    expect(webhookReferenceOf({ orderId: other, data: { orderId: PAYMENT_ID } })).toMatchObject({
      paymentId: PAYMENT_ID,
    })
  })

  it('ignores an order id that is not a uuid', () => {
    // `Payment.id` 는 uuid 컬럼이라 아무 문자열로 조회하면 Postgres 가 던지고, 그
    // 예외는 500 이 되어 PG 가 영원히 재전송한다 — 남의 웹훅 하나가 우리 로그를
    // 채우는 모양이다.
    expect(webhookReferenceOf({ orderId: 'ORDER-2026-0001' })).toEqual({
      paymentId: null,
      paymentKey: null,
    })
  })

  it('ignores a blank payment key', () => {
    expect(webhookReferenceOf({ paymentKey: '   ' })).toMatchObject({ paymentKey: null })
  })

  it('answers nothing for a body with neither key', () => {
    expect(webhookReferenceOf({ eventType: 'PAYMENT_STATUS_CHANGED' })).toEqual({
      paymentId: null,
      paymentKey: null,
    })
  })

  it('answers nothing for a body that is not an object', () => {
    expect(webhookReferenceOf('hello')).toEqual({ paymentId: null, paymentKey: null })
    expect(webhookReferenceOf(null)).toEqual({ paymentId: null, paymentKey: null })
  })

  it('answers nothing when the fields are the wrong type', () => {
    expect(webhookReferenceOf({ orderId: 42, data: 'nope' })).toEqual({
      paymentId: null,
      paymentKey: null,
    })
  })

  it('tolerates fields it does not know', () => {
    // 결제사가 필드를 하나 더 붙이는 날 모든 웹훅이 거부되면 안 된다. 우리가 읽는
    // 것은 두 값뿐이므로 나머지는 있든 없든 상관이 없어야 한다.
    expect(
      webhookReferenceOf({
        eventType: 'PAYMENT_STATUS_CHANGED',
        createdAt: '2026-09-05T00:00:00.000Z',
        data: { orderId: PAYMENT_ID, status: 'DONE', totalAmount: 40_000, newField: true },
      }),
    ).toMatchObject({ paymentId: PAYMENT_ID })
  })
})
