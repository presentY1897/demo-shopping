/**
 * axe over the checkout (P2).
 *
 * 이 화면이 새로 들여오는 것은 **매초 바뀌는 영역**과 라디오 그룹이다. 앞의 것은
 * `aria-live` 를 잘못 쓰면 초마다 읽어 주는 화면이 되고 — 그러면 화면을 보지 않는
 * 사람은 아무것도 할 수 없다 — 뒤의 것은 `fieldset`/`legend` 없이 두면 「무엇을
 * 고르는 라디오인지」가 접근성 트리에 없다.
 *
 * 결제수단(TASK-0054)이 그 둘을 하나씩 더 들여왔다: **비활성 라디오**와 **결과를
 * 알리는 영역**이다. 앞의 것은 이유가 접근성 트리에 없으면 「왜 못 고르는지」를
 * 아무도 듣지 못하고, 뒤의 것은 실패했을 때에야 나타나면 읽히지 않는다. 아래
 * 검사가 카드를 고르고 실제로 거절당한 화면까지 재는 이유다.
 *
 * 규칙 집합은 이 앱의 것을 다시 적는다 — `packages/ui` 의 사본은 `stories/` 까지
 * 닿지 않는 `exports` 맵 뒤에 있다.
 */

import {
  resetCheckoutStore,
  resetPaymentStore,
  sessionBuyer,
  shopperCards,
  shopperCheckout,
  unresolveNextApproval,
} from '@shopping/api-mocks'
import { DENSITY_LEVELS } from '@shopping/ui'
import { DensityProvider } from '@shopping/ui/density'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { navigation } from './support/navigation'
import { resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const { default: CheckoutPage } = await import('@/app/checkout/[id]/page')

const copy = messagesFor().checkout
const { checkout } = shopperCheckout

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

/** 앞 검사의 해제 신호를 흘려보내고 다시 연다 — `checkout-page.spec.tsx` 와 같은 이유다. */
async function renderCheckout(width: number = VIEWPORTS.desktop) {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
  resetCheckoutStore()

  stubViewport(width)
  navigation.start(`/checkout/${checkout.id}`)

  const result = renderWithAuth(
    <DensityProvider>
      {await CheckoutPage({ params: Promise.resolve({ id: checkout.id }) })}
    </DensityProvider>,
    { session: sessionBuyer },
  )

  await screen.findByRole('region', { name: copy.itemsTitle })

  return result
}

beforeEach(() => {
  resetDensity()
  resetCheckoutStore()
  resetPaymentStore()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(new Date(checkout.expiresAt).getTime() - 10 * 60 * 1000))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('주문서 접근성 (P2)', () => {
  it.each(DENSITY_LEVELS)('passes at density %s', async (density) => {
    window.localStorage.setItem('shopping.density', String(density))

    await renderCheckout()

    await expectNoViolations()
  })

  it('passes on a phone', async () => {
    await renderCheckout(VIEWPORTS.mobile)

    await expectNoViolations()
  })

  it('passes inside the last three minutes, where the timer changes its tone', async () => {
    vi.setSystemTime(new Date(new Date(checkout.expiresAt).getTime() - 2 * 60 * 1000))

    await renderCheckout()

    await expectNoViolations()
  })

  it('passes with a declined payment on the screen', async () => {
    const user = userEvent.setup()
    // 한도가 모자란 카드. 이 화면에서 거절을 만드는 방법이 그것 하나다.
    const tight = shopperCards.cards.find((card) => card.creditLimit < checkout.paidAmount)

    if (tight === undefined) throw new Error('한도가 모자란 씨앗 카드가 없다')

    await renderCheckout()

    const section = await screen.findByRole('region', { name: copy.payment.title })

    await within(section).findByRole('group', { name: copy.payment.chooseMethod })
    await user.click(within(section).getByRole('radio', { name: new RegExp(tight.brand, 'u') }))

    const summary = screen.getByRole('complementary', { name: copy.summaryTitle })

    await user.click(within(summary).getByRole('checkbox', { name: copy.termsLabel }))
    await user.click(within(summary).getByRole('button', { name: copy.placeOrder }))
    await screen.findByText(copy.payment.holdKept)

    await expectNoViolations()
  })

  /**
   * 확인 중 — 버튼 없이 문장만 남는 화면 (TASK-0057 F5 · D-220).
   *
   * **이 상태가 새로 들여오는 것은 「사라진 버튼」이다.** 다른 실패에는 `aria-live`
   * 영역 뒤에 초점을 받는 버튼이 하나 따라오는데 여기에는 없고, 그러면 화면을 보지
   * 않는 사람이 듣는 것은 그 문장 하나뿐이다 — 그 문장이 실제로 읽히는 자리에
   * 있는지, 그리고 버튼이 빠진 자리가 순회를 끊지 않는지를 밀도 3단계와 좁은
   * 뷰포트에서 각각 확인한다.
   */
  describe('확인 중인 결제가 떠 있는 화면', () => {
    async function awaitingResult(width: number = VIEWPORTS.desktop): Promise<void> {
      const user = userEvent.setup()

      await renderCheckout(width)

      const section = await screen.findByRole('region', { name: copy.payment.title })

      await within(section).findByRole('group', { name: copy.payment.chooseMethod })

      // 이 화면에서 「확인 중」을 만드는 방법은 이것 하나다 — 가상 카드는 한도로
      // 거절할 수는 있어도 「답이 안 왔다」를 만들지 못한다.
      unresolveNextApproval()

      const summary = screen.getByRole('complementary', { name: copy.summaryTitle })

      await user.click(within(summary).getByRole('checkbox', { name: copy.termsLabel }))
      await user.click(within(summary).getByRole('button', { name: copy.placeOrder }))
      await screen.findByText(copy.payment.awaitingHoldKept)
    }

    it.each(DENSITY_LEVELS)('passes at density %s', async (density) => {
      window.localStorage.setItem('shopping.density', String(density))

      await awaitingResult()

      await expectNoViolations()
    })

    it('passes on a phone', async () => {
      await awaitingResult(VIEWPORTS.mobile)

      await expectNoViolations()
    })
  })

  it('passes on the expiry screen', async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
    resetCheckoutStore()
    vi.setSystemTime(new Date(new Date(checkout.expiresAt).getTime() + 1_000))
    stubViewport(VIEWPORTS.desktop)
    navigation.start(`/checkout/${checkout.id}`)

    renderWithAuth(
      <DensityProvider>
        {await CheckoutPage({ params: Promise.resolve({ id: checkout.id }) })}
      </DensityProvider>,
      { session: sessionBuyer },
    )

    await screen.findByText(copy.expiredTitle)
    await expectNoViolations()
  })
})
