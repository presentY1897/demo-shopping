/**
 * axe over everything TASK-0055 added (P2).
 *
 * 새로 들여온 것이 셋이다. **선택지 아래 펼쳐지는 안내**는 `label` 안에 넣으면 그
 * 문단 전체가 라디오의 이름이 되고 그 안의 링크가 라디오에 든 두 번째 조작 대상이
 * 된다 — 그것이 여기서 잡혀야 할 첫 번째다. **돌아온 뒤의 진행 화면**은 사람이 할 수
 * 있는 일이 없는 동안 「무엇을 기다리는가」가 접근성 트리에 있어야 하고, **실패
 * 화면**은 나가는 길이 이름 있는 링크여야 한다.
 *
 * 규칙 집합은 `checkout-a11y.spec.tsx` 의 것을 그대로 쓴다 — 같은 앱의 같은 판단이고,
 * 갈리면 한쪽만 통과하는 화면이 생긴다.
 */

import {
  resetCheckoutStore,
  resetPaymentStore,
  sessionBuyer,
  shopperCheckout,
  shopperOrder,
} from '@shopping/api-mocks'
import { DENSITY_LEVELS } from '@shopping/ui'
import { DensityProvider } from '@shopping/ui/density'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startTossPayment } from '@/lib/payment/payment-api'
import type * as TossModule from '@/lib/payment/toss'
import type { TossCheckout } from '@/lib/payment/toss'
import { openTossCheckout } from '@/lib/payment/toss'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { navigation } from './support/navigation'
import { resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

vi.mock('@/lib/payment/toss', async (importOriginal) => ({
  ...(await importOriginal<typeof TossModule>()),
  openTossCheckout: vi.fn<TossCheckout>(),
}))

const { default: CheckoutPage } = await import('@/app/checkout/[id]/page')
const { default: TossSuccessPage } = await import('@/app/checkout/toss/success/page')
const { default: TossFailPage } = await import('@/app/checkout/toss/fail/page')

const copy = messagesFor().checkout
const pay = copy.payment
const { checkout } = shopperCheckout

const CLIENT_KEY = 'test_ck_0000000000000000000000000000'
const PAYMENT_KEY = 'tviva20260905123456ABCD'

const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    // jsdom paints nothing, so axe cannot decide contrast.
    'color-contrast': { enabled: false },
    // 문서 껍데기는 `app/layout.tsx` 의 것이고 여기서 렌더되지 않는다.
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    region: { enabled: false },
  },
}

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

/** 토스를 고른 주문서. 안내가 펼쳐진 상태다. */
async function renderCheckoutWithToss(width: number = VIEWPORTS.desktop): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
  resetCheckoutStore()
  resetPaymentStore()

  stubViewport(width)
  navigation.start(`/checkout/${checkout.id}`)

  renderWithAuth(
    <DensityProvider>
      {await CheckoutPage({ params: Promise.resolve({ id: checkout.id }) })}
    </DensityProvider>,
    { session: sessionBuyer },
  )

  const user = userEvent.setup()
  const section = await screen.findByRole('region', { name: pay.title })

  await within(section).findByRole('group', { name: pay.chooseMethod })
  await user.click(within(section).getByRole('radio', { name: pay.toss.label }))
  await screen.findByText(pay.toss.noticeTitle)
}

function renderReturn(page: () => React.ReactNode, href: string): void {
  stubViewport(VIEWPORTS.desktop)
  navigation.start(href)

  renderWithAuth(<DensityProvider>{page()}</DensityProvider>, { session: sessionBuyer })
}

/** 돌아온 화면이 승인을 걸 수 있도록 결제를 하나 열어 둔다. */
async function successHref(amount?: number): Promise<string> {
  const payment = await startTossPayment(shopperOrder.order.id)
  const query = new URLSearchParams({
    amount: String(amount ?? payment.authorizedAmount),
    checkout: checkout.id,
    orderId: payment.id,
    paymentKey: PAYMENT_KEY,
  })

  return `/checkout/toss/success?${query.toString()}`
}

beforeEach(() => {
  resetDensity()
  resetCheckoutStore()
  resetPaymentStore()
  vi.mocked(openTossCheckout).mockReset()
  vi.mocked(openTossCheckout).mockResolvedValue(undefined)
  vi.stubEnv('NEXT_PUBLIC_TOSS_CLIENT_KEY', CLIENT_KEY)
  // **`Date` 만 가짜로 만든다** — 주문서가 만료되지 않은 시점에 서 있어야 결제수단
  // 영역이 그려진다. `checkout-a11y.spec.tsx` 가 같은 이유로 같은 줄을 갖는다.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(new Date(checkout.expiresAt).getTime() - 10 * 60 * 1000))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('토스 선택지가 붙은 주문서 (P2 · P6)', () => {
  it.each(DENSITY_LEVELS)('passes at density %s with the notice open', async (density) => {
    window.localStorage.setItem('shopping.density', String(density))

    await renderCheckoutWithToss()
    await expectNoViolations()
  })

  it('passes on a phone (P3)', async () => {
    await renderCheckoutWithToss(VIEWPORTS.mobile)
    await expectNoViolations()
  })

  it('passes while the browser is leaving for the payment window', async () => {
    const user = userEvent.setup()

    await renderCheckoutWithToss()

    const summary = screen.getByRole('complementary', { name: copy.summaryTitle })

    await user.click(within(summary).getByRole('checkbox', { name: copy.termsLabel }))
    await user.click(within(summary).getByRole('button', { name: copy.placeOrder }))
    await screen.findByText(pay.toss.leaving)

    await expectNoViolations()
  })
})

describe('돌아온 화면 (P2 · P5)', () => {
  it('passes while the approval is still running', async () => {
    renderReturn(TossSuccessPage, await successHref())

    // 승인이 끝나기 전의 프레임. 사람이 할 수 있는 일이 없는 동안에도 「무엇을
    // 기다리는가」는 접근성 트리에 있어야 한다.
    expect(screen.getByText(copy.tossSuccess.confirming)).toBeVisible()
    await expectNoViolations()

    await screen.findByText(copy.tossSuccess.doneTitle)
  })

  it('passes once the payment is done', async () => {
    renderReturn(TossSuccessPage, await successHref())

    await screen.findByText(copy.tossSuccess.doneTitle)
    await expectNoViolations()
  })

  it('passes when the approval was refused', async () => {
    const href = await successHref(checkout.paidAmount + 1_000)

    renderReturn(TossSuccessPage, href)

    await screen.findByText(copy.tossSuccess.failures.amount_mismatch)
    await expectNoViolations()
  })

  it('passes on the closed-window screen', async () => {
    renderReturn(
      TossFailPage,
      `/checkout/toss/fail?checkout=${checkout.id}&code=PAY_PROCESS_CANCELED`,
    )

    await screen.findByText(copy.tossFailure.titles.canceled)
    await expectNoViolations()
  })
})
