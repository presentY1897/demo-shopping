/**
 * axe over the cart (P2).
 *
 * 이 화면이 새로 들여오는 것은 **세 층의 체크박스**다 — 전체 · 그룹 · 개별. 그중
 * 맨 위는 `indeterminate` 상태를 갖고, 그 상태를 속성이 아니라 프로퍼티로 주므로
 * 접근성 트리에 제대로 나타나는지가 검사할 값이 있는 질문이다. 그룹은
 * `region` 이고 이름이 브랜드명이라, 이름 없는 랜드마크가 되면 `landmark-unique`
 * 가 잡는다.
 *
 * 규칙 집합은 이 앱의 것을 다시 적는다 — `packages/ui` 의 사본은 `stories/` 까지
 * 닿지 않는 `exports` 맵 뒤에 있다(`mypage-a11y.spec.tsx` 가 같은 이유를 적었다).
 */

import { emptyCart, resetCartStore, sessionBuyer } from '@shopping/api-mocks'
import { DENSITY_LEVELS } from '@shopping/ui'
import { DensityProvider } from '@shopping/ui/density'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 팩토리가 자기 의존을 스스로 들여온다.
 *
 * `vi.mock` 은 모든 import 위로 끌어올려지므로, 최상위 바인딩을 닫아 쓰는 팩토리는
 * 그 바인딩이 생기기 전에 돈다 — `Cannot access '__vi_import_N__'` 가 애먼
 * 컴포넌트를 범인으로 지목한다.
 */
vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const { default: CartPage } = await import('@/app/cart/page')
import { forgetCartCount } from '@/lib/cart/cart-count'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { navigation } from './support/navigation'
import { resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'

const copy = messagesFor().cart

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

async function renderCart(width: number = VIEWPORTS.desktop) {
  stubViewport(width)

  const result = renderWithAuth(
    <DensityProvider>
      <CartPage />
    </DensityProvider>,
    { session: sessionBuyer },
  )

  await screen.findByRole('heading', { level: 1, name: copy.title })

  return result
}

beforeEach(() => {
  resetDensity()
  resetCartStore()
  navigation.start('/cart')
  forgetCartCount()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('장바구니 접근성 (P2)', () => {
  it.each(DENSITY_LEVELS)('passes at density %s', async (density) => {
    window.localStorage.setItem('shopping.density', String(density))

    await renderCart()
    await screen.findByRole('region', { name: '루미에르' })

    await expectNoViolations()
  })

  it('passes on a phone', async () => {
    await renderCart(VIEWPORTS.mobile)
    await screen.findByRole('region', { name: '루미에르' })

    await expectNoViolations()
  })

  it('passes when the cart is empty', async () => {
    resetCartStore(emptyCart)

    await renderCart()
    await screen.findByText(copy.emptyTitle)

    await expectNoViolations()
  })

  it('passes with a partly chosen group, where the top box is indeterminate', async () => {
    // `indeterminate` 는 속성이 아니라 프로퍼티라 JSX 로 쓸 수 없다. 접근성
    // 트리에 `aria-checked="mixed"` 로 나타나는지는 그래서 검사할 값이 있다.
    const user = userEvent.setup()

    await renderCart()

    const coat = await screen.findByRole('checkbox', {
      name: copy.selectItem.replace('{name}', '울 롱코트'),
    })

    await user.click(coat)

    expect(
      screen.getByRole('checkbox', { name: copy.selectAll.replace('{count}', '3') }),
    ).toHaveProperty('indeterminate', true)

    await expectNoViolations()
  })
})
