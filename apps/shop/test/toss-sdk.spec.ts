/**
 * 결제창을 여는 자리 하나 (TASK-0055 4.3 · 4.8).
 *
 * **로더가 인자라서 잴 수 있다.** 진짜 CDN 스크립트 대신 전역을 흉내 내는 것을
 * 넘기면, 남는 질문은 하나다 — **우리가 무엇을 어떤 모양으로 넘겼는가.** 그것이
 * 4.2 가 말하는 「우리 쪽 절반」이고, 저쪽이 그 값을 잘 처리하는지는 사람이 키를
 * 넣고 눌러 봐야 아는 종류다.
 *
 * 이 파일에서 `js.tosspayments.com` 에 닿는 요청은 하나도 없다. 스크립트를 붙이는
 * 코드는 로더 안에 있고, 로더를 부르는 검사가 여기 없다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TossPaymentsFactory, TossRequestPayment } from '@/lib/payment/toss'
import { openTossCheckout, tossClientKey, tossReturnUrls } from '@/lib/payment/toss'

const REQUEST = {
  amount: 476_500,
  clientKey: 'test_ck_0000000000000000000000000000',
  failUrl: 'http://localhost:3000/checkout/toss/fail?checkout=c1',
  orderName: '울 롱코트 외 2건',
  paymentId: '019596d0-1f1c-7c2e-9a0e-6b0000000001',
  successUrl: 'http://localhost:3000/checkout/toss/success?checkout=c1',
} as const

/** 전역 `TossPayments` 를 흉내 낸 것. 검사가 보는 것은 이 안으로 들어온 값이다. */
function fakeSdk() {
  const requestPayment = vi.fn<(request: TossRequestPayment) => Promise<unknown>>()
  const payment = vi.fn((options: { readonly customerKey: string }) => {
    void options

    return { requestPayment }
  })
  const factory = vi.fn((clientKey: string) => {
    void clientKey

    return { payment }
  }) as unknown as TossPaymentsFactory & {
    mock: { calls: string[][] }
  }

  return { factory, payment, requestPayment }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('키가 없으면 토스가 없다 (4.1)', () => {
  it('is null when nobody set the key', () => {
    vi.stubEnv('NEXT_PUBLIC_TOSS_CLIENT_KEY', undefined)

    expect(tossClientKey()).toBeNull()
  })

  it('treats a blank value as no key at all', () => {
    // `.env` 에 이름만 남기고 값을 지운 상태가 흔하다. 빈 문자열로 결제창을 부르면
    // 창이 뜨다 말고, 그 증상은 사용자에게 「결제 실패」로만 보인다.
    vi.stubEnv('NEXT_PUBLIC_TOSS_CLIENT_KEY', '   ')

    expect(tossClientKey()).toBeNull()
  })

  it('is the key when there is one, read at call time', () => {
    vi.stubEnv('NEXT_PUBLIC_TOSS_CLIENT_KEY', REQUEST.clientKey)

    // **불릴 때 읽는다.** 모듈 최상위에서 굳혔다면 이 줄이 통과할 수 없다 — 그리고
    // 키가 있는 상태와 없는 상태를 한 프로세스에서 둘 다 재는 것도 불가능해진다.
    expect(tossClientKey()).toBe(REQUEST.clientKey)
  })
})

describe('결제창에 넘기는 것', () => {
  it('gives Toss our payment id as its orderId (4.3)', async () => {
    const sdk = fakeSdk()

    await openTossCheckout(REQUEST, () => Promise.resolve(sdk.factory))

    // 토스는 자기가 부르는 `orderId` 로 멱등을 판단한다. 거기에 우리 주문 id 를 주면
    // 한 주문에 결제를 두 번 시도할 수 없고, 첫 시도가 실패해 다른 수단으로 다시
    // 하는 것이 정확히 그 경우다.
    expect(sdk.requestPayment.mock.calls[0]?.[0].orderId).toBe(REQUEST.paymentId)
  })

  it('asks for a card payment in won, at the amount it was given', async () => {
    const sdk = fakeSdk()

    await openTossCheckout(REQUEST, () => Promise.resolve(sdk.factory))

    expect(sdk.requestPayment).toHaveBeenCalledWith({
      amount: { currency: 'KRW', value: REQUEST.amount },
      failUrl: REQUEST.failUrl,
      method: 'CARD',
      orderId: REQUEST.paymentId,
      orderName: REQUEST.orderName,
      successUrl: REQUEST.successUrl,
    })
  })

  it('opens the session anonymously, with the client key', async () => {
    const sdk = fakeSdk()

    await openTossCheckout(REQUEST, () => Promise.resolve(sdk.factory))

    // 우리 계정 id 를 넣으면 그 사람의 카드가 저쪽에 저장된다 — 자동결제(빌링)의
    // 이야기이지 이 TASK 의 것이 아니다.
    expect(sdk.payment).toHaveBeenCalledWith({ customerKey: 'ANONYMOUS' })
  })

  it('fails when the script cannot be had, without opening anything', async () => {
    const sdk = fakeSdk()

    await expect(
      openTossCheckout(REQUEST, () => Promise.reject(new Error('blocked'))),
    ).rejects.toThrow('blocked')

    // 차단된 스크립트와 열린 결제창은 사람에게 전혀 다른 상황이다. 앞의 경우에
    // 아무것도 열리지 않았다는 것이 「가상 카드로 해 보세요」를 옳은 말로 만든다.
    expect(sdk.requestPayment).not.toHaveBeenCalled()
  })
})

describe('돌아올 주소', () => {
  it('carries the checkout id, because Toss will not', () => {
    const urls = tossReturnUrls('https://shop.example', '019596d0-1f1c-7c2e-9a0e-5e0000000001')

    expect(urls.successUrl).toBe(
      'https://shop.example/checkout/toss/success?checkout=019596d0-1f1c-7c2e-9a0e-5e0000000001',
    )
    expect(urls.failUrl).toBe(
      'https://shop.example/checkout/toss/fail?checkout=019596d0-1f1c-7c2e-9a0e-5e0000000001',
    )
  })

  it('escapes the id rather than pasting it in', () => {
    // 주문서 id 는 uuid 라 오늘은 이스케이프할 것이 없다. 그래도 붙이는 것이 아니라
    // 인코딩하는 이유는, 이 값이 언젠가 uuid 가 아니게 되는 날 조용히 깨지는 쪽이
    // 훨씬 찾기 어렵기 때문이다.
    expect(tossReturnUrls('https://shop.example', 'a b&c').successUrl).toContain(
      'checkout=a%20b%26c',
    )
  })
})
