/**
 * axe over the checkout (P2).
 *
 * 이 화면이 새로 들여오는 것은 **매초 바뀌는 영역**과 라디오 그룹이다. 앞의 것은
 * `aria-live` 를 잘못 쓰면 초마다 읽어 주는 화면이 되고 — 그러면 화면을 보지 않는
 * 사람은 아무것도 할 수 없다 — 뒤의 것은 `fieldset`/`legend` 없이 두면 「무엇을
 * 고르는 라디오인지」가 접근성 트리에 없다.
 *
 * 규칙 집합은 이 앱의 것을 다시 적는다 — `packages/ui` 의 사본은 `stories/` 까지
 * 닿지 않는 `exports` 맵 뒤에 있다.
 */

import { resetCheckoutStore, sessionBuyer, shopperCheckout } from '@shopping/api-mocks'
import { DENSITY_LEVELS } from '@shopping/ui'
import { DensityProvider } from '@shopping/ui/density'
import { screen } from '@testing-library/react'
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
