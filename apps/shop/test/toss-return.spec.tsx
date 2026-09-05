/**
 * 결제창이 돌아온 두 화면 (TASK-0055 4.2 · F1 · F3 · F4).
 *
 * **재는 것은 하나로 모인다: 결제창의 성공을 완료로 착각하지 않는가.** 성공 주소로
 * 돌아온 것은 카드사 인증까지 끝났다는 뜻일 뿐이고, 승인은 서버가 우리 열쇠로 부른
 * 뒤에야 끝난다 — 그래서 이 파일의 절반은 **승인이 실패했을 때 매입을 부르지
 * 않는가**를 센다.
 *
 * 결제는 앱 자신의 `startTossPayment` 로 연다. 목에 상태를 심는 손잡이를 따로 두지
 * 않는 이유는, 그 손잡이가 곧 「대역만 아는 상태」가 되기 때문이다 — 화면이 지나는
 * 길로 열어 두면 승인 라우트가 보는 결제와 검사가 만든 결제가 같은 것임이 보장된다.
 */

import {
  declineNextTossApproval,
  httpFailureOn,
  mockPaths,
  resetCheckoutStore,
  resetPaymentStore,
  sessionBuyer,
  shopperCheckout,
  shopperOrder,
} from '@shopping/api-mocks'
import { DensityProvider } from '@shopping/ui/density'
import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { confirmTossPayment, startTossPayment } from '@/lib/payment/payment-api'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { navigation } from './support/navigation'
import { resetDensity } from './support/mypage'
import { testServer } from './setup'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const { default: TossSuccessPage } = await import('@/app/checkout/toss/success/page')
const { default: TossFailPage } = await import('@/app/checkout/toss/fail/page')

const copy = messagesFor().checkout
const done = copy.tossSuccess
const failed = copy.tossFailure
const { checkout } = shopperCheckout

/** 결제창이 돌려줬을 법한 키. 우리는 이 값을 서버에 그대로 넘길 뿐이다. */
const PAYMENT_KEY = 'tviva20260905123456ABCD'

let sent: string[] = []

/** 이 주문에 토스 결제를 하나 연다 — 주문서가 결제창으로 떠나기 직전의 상태다. */
async function openTossPayment(): Promise<{ id: string; authorizedAmount: number }> {
  const payment = await startTossPayment(shopperOrder.order.id)

  return { authorizedAmount: payment.authorizedAmount, id: payment.id }
}

function returnUrl(path: string, params: Readonly<Record<string, string | undefined>>): string {
  const query = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value)
  }

  return `${path}?${query.toString()}`
}

function renderReturn(page: () => React.ReactNode, href: string) {
  stubViewport(VIEWPORTS.desktop)
  navigation.start(href)

  return renderWithAuth(<DensityProvider>{page()}</DensityProvider>, { session: sessionBuyer })
}

function captured(): boolean {
  return sent.some((each) => each.endsWith('/capture'))
}

beforeEach(() => {
  resetDensity()
  resetCheckoutStore()
  resetPaymentStore()
  sent = []
  testServer.server.events.on('request:start', ({ request }) => {
    sent.push(`${request.method} ${new URL(request.url).pathname.replace('/api/v1', '')}`)
  })
})

afterEach(() => {
  testServer.server.events.removeAllListeners('request:start')
  vi.unstubAllGlobals()
})

describe('승인하고 나서 확정한다 (F1 · 4.2)', () => {
  it('confirms first, captures second, and only then says it is done', async () => {
    const payment = await openTossPayment()

    renderReturn(
      TossSuccessPage,
      returnUrl('/checkout/toss/success', {
        amount: String(payment.authorizedAmount),
        checkout: checkout.id,
        orderId: payment.id,
        paymentKey: PAYMENT_KEY,
      }),
    )

    expect(await screen.findByText(done.doneTitle)).toBeVisible()

    // **순서가 계약이다** (D-031). 승인 없이 매입하면 409 이고, 매입 없이 끝내면
    // 주문이 `PAID` 로 가지 않는다 — 두 요청이 이 순서로 나가야 결제가 끝난다.
    // (`POST /payments` 는 이 검사가 결제를 여느라 보낸 것이고, `/auth/refresh` 는
    // 세션을 세우는 부팅 요청이라 이 화면의 것이 아니다.)
    expect(sent.filter((each) => each.startsWith(`POST /payments/${payment.id}`))).toEqual([
      `POST /payments/${payment.id}/toss/confirm`,
      `POST /payments/${payment.id}/capture`,
    ])
  })

  it('says what it is waiting for while it waits', async () => {
    const payment = await openTossPayment()

    renderReturn(
      TossSuccessPage,
      returnUrl('/checkout/toss/success', {
        amount: String(payment.authorizedAmount),
        checkout: checkout.id,
        orderId: payment.id,
        paymentKey: PAYMENT_KEY,
      }),
    )

    // 첫 프레임이 이미 「승인하는 중」이다. 결제창에서 막 돌아온 사람에게 빈 화면을
    // 보여 주면 그 사람은 새로고침을 누르고, 그것이 409 를 만든다.
    expect(screen.getByText(done.confirming)).toBeVisible()
    await screen.findByText(done.doneTitle)
  })
})

describe('승인이 안 되면 확정하지 않는다 (F4)', () => {
  it('does not capture when the amount does not match (F2)', async () => {
    const payment = await openTossPayment()

    renderReturn(
      TossSuccessPage,
      returnUrl('/checkout/toss/success', {
        // 쿼리스트링은 사용자가 고칠 수 있는 값이다. 서버는 DB 의 승인액과 대조한
        // **뒤에야** 토스를 부르므로, 어긋난 이 요청은 저쪽에 닿지도 않았다.
        amount: String(payment.authorizedAmount + 1_000),
        checkout: checkout.id,
        orderId: payment.id,
        paymentKey: PAYMENT_KEY,
      }),
    )

    expect(await screen.findByText(done.failures.amount_mismatch)).toBeVisible()
    expect(captured()).toBe(false)
    expect(screen.queryByText(done.doneTitle)).toBeNull()
  })

  it('does not capture when the card refused, and offers another go', async () => {
    const payment = await openTossPayment()

    // 거절은 예외가 아니라 값이다 (TASK-0052 4.3) — 200 으로 `FAILED` 인 결제가 온다.
    declineNextTossApproval()

    renderReturn(
      TossSuccessPage,
      returnUrl('/checkout/toss/success', {
        amount: String(payment.authorizedAmount),
        checkout: checkout.id,
        orderId: payment.id,
        paymentKey: PAYMENT_KEY,
      }),
    )

    expect(await screen.findByText(done.failures.declined)).toBeVisible()
    expect(captured()).toBe(false)
    expect(screen.getByRole('link', { name: done.backToCheckout })).toHaveAttribute(
      'href',
      `/checkout/${checkout.id}`,
    )
  })

  it('refuses to retry a payment that was already settled', async () => {
    const payment = await openTossPayment()

    // 성공 주소를 새로고침하거나 뒤로 갔다 다시 온 사람이 정확히 이 경우다.
    await confirmTossPayment(payment.id, PAYMENT_KEY, payment.authorizedAmount)
    sent = []

    renderReturn(
      TossSuccessPage,
      returnUrl('/checkout/toss/success', {
        amount: String(payment.authorizedAmount),
        checkout: checkout.id,
        orderId: payment.id,
        paymentKey: PAYMENT_KEY,
      }),
    )

    expect(await screen.findByText(done.failures.already_settled)).toBeVisible()
    expect(captured()).toBe(false)
    // **「다시 결제하기」를 주지 않는다.** 그 결제는 이미 끝났을 수 있고, 우리는 이
    // 응답만으로 성공인지 실패인지를 모른다 — 권하면 한 사람이 두 번 낸다.
    expect(screen.queryByRole('link', { name: done.backToCheckout })).toBeNull()
    expect(screen.getByRole('link', { name: done.backHome })).toBeVisible()
  })

  it('will not tell somebody to pay again when the money is already authorized', async () => {
    const payment = await openTossPayment()

    testServer.server.use(
      httpFailureOn('post', mockPaths.paymentCapture, 500, 'INTERNAL_ERROR', '확정하지 못했어요'),
    )

    renderReturn(
      TossSuccessPage,
      returnUrl('/checkout/toss/success', {
        amount: String(payment.authorizedAmount),
        checkout: checkout.id,
        orderId: payment.id,
        paymentKey: PAYMENT_KEY,
      }),
    )

    // 승인은 끝났고 우리 쪽만 확정되지 않았다 — 저쪽에 승인이 남아 있으므로 다시
    // 결제하면 두 번 낸다. 그 어긋남을 맞추는 것은 대사의 몫이다 (TASK-0056 · 0057).
    expect(await screen.findByText(done.failures.unsettled)).toBeVisible()
    expect(screen.queryByRole('link', { name: done.backToCheckout })).toBeNull()
  })
})

describe('결제창에서 온 주소가 아닐 때', () => {
  it('asks for nothing at all and says so', async () => {
    renderReturn(
      TossSuccessPage,
      returnUrl('/checkout/toss/success', { checkout: checkout.id, orderId: 'x' }),
    )

    expect(await screen.findByText(done.failures.invalid_return)).toBeVisible()
    // 승인을 시도할 것이 없다. 반쯤 채워진 쿼리로 서버를 부르면 그 실패는 조작
    // 시도와 구분되지 않고, 대조 로그에 남을 이유도 없다.
    expect(sent.filter((each) => each.includes('/payments'))).toEqual([])
  })
})

describe('결제창을 닫았을 때 (F3)', () => {
  it('does not call it a failure, and says the order is still there', async () => {
    renderReturn(
      TossFailPage,
      returnUrl('/checkout/toss/fail', {
        checkout: checkout.id,
        code: 'PAY_PROCESS_CANCELED',
        message: '사용자가 결제를 취소했습니다',
      }),
    )

    expect(await screen.findByText(failed.titles.canceled)).toBeVisible()
    // 먼저 말할 것은 「주문과 예약이 그대로 있다」이다. 말해 주지 않으면 사람은
    // 처음부터 다시 시작하고, 그 사이 15분 동안 그 재고는 아무에게도 가지 않는다.
    expect(screen.getByText(new RegExp(failed.holdKept, 'u'))).toBeVisible()
    expect(screen.getByRole('link', { name: failed.backToCheckout })).toHaveAttribute(
      'href',
      `/checkout/${checkout.id}`,
    )
  })

  it('uses different words when the window did not close on purpose', async () => {
    renderReturn(
      TossFailPage,
      returnUrl('/checkout/toss/fail', { checkout: checkout.id, code: 'REJECT_CARD_COMPANY' }),
    )

    expect(await screen.findByText(failed.titles.refused)).toBeVisible()
    expect(screen.queryByText(failed.titles.canceled)).toBeNull()
  })

  it('never repeats the sentence Toss put in the query', async () => {
    renderReturn(
      TossFailPage,
      returnUrl('/checkout/toss/fail', {
        checkout: checkout.id,
        code: 'PAY_PROCESS_CANCELED',
        message: '<남이 쓴 문장>',
      }),
    )

    await screen.findByText(failed.titles.canceled)
    // 쿼리는 사용자가 고칠 수 있는 값이다. 남이 쓴 문장을 우리 화면에 옮기면 읽는
    // 사람이 우리가 한 말과 남이 한 말을 구분할 수 없다.
    expect(screen.queryByText(/남이 쓴 문장/u)).toBeNull()
  })

  it('falls back to the cart when we lost the checkout id', async () => {
    renderReturn(TossFailPage, returnUrl('/checkout/toss/fail', { code: 'PAY_PROCESS_CANCELED' }))

    expect(await screen.findByRole('link', { name: failed.backToCart })).toHaveAttribute(
      'href',
      '/cart',
    )
  })

  it('calls the API for nothing — the window closed before anything moved', async () => {
    renderReturn(
      TossFailPage,
      returnUrl('/checkout/toss/fail', { checkout: checkout.id, code: 'PAY_PROCESS_CANCELED' }),
    )

    await screen.findByText(failed.titles.canceled)

    expect(sent.filter((each) => each.includes('/payments'))).toEqual([])
  })
})
