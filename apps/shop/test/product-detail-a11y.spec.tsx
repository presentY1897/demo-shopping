/**
 * axe over the product detail screen, at every density and both purchase forms (P2).
 *
 * This screen is the one TASK-0043 calls the representative test of P6, and it
 * is also where the most arrangements exist that only appear once assembled: a
 * gallery whose strip is a scroll region with its own controls, option buttons
 * that are `aria-disabled` rather than `disabled`, and a purchase area that is a
 * fixed bar on a phone and a panel on a desktop.
 *
 * The rule set is this app's, restated for the reason `mypage-a11y.spec.tsx`
 * gives — `packages/ui`'s copy is behind an `exports` map that does not reach
 * into `stories/`.
 */

import { storefrontProductDetail, storefrontProductWithoutOptions } from '@shopping/api-mocks'
import { DENSITY_LEVELS, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { DensityProvider } from '@shopping/ui/density'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { stubReviewApi } from './support/reviews'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const { default: ProductPage } = await import('@/app/products/[id]/page')

const copy = messagesFor().productDetail
const product = storefrontProductDetail.product

const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    // jsdom paints nothing, so axe cannot decide contrast.
    'color-contrast': { enabled: false },
    // The document shell — lang, title, the `main` landmark — belongs to
    // `app/layout.tsx`, which is not rendered here.
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    region: { enabled: false },
    'landmark-one-main': { enabled: false },
  },
}

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

async function renderDetail(
  id: string = product.id,
  { width = VIEWPORTS.desktop, density = 2 }: { width?: number; density?: number } = {},
) {
  localStorage.setItem(DENSITY_STORAGE_KEY, String(density))
  document.documentElement.setAttribute('data-density', String(density))
  stubViewport(width)

  return renderWithAuth(
    <DensityProvider>{await ProductPage({ params: Promise.resolve({ id }) })}</DensityProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  /*
   * 리뷰 섹션이 상품 상세 안에 있으므로 이 파일의 렌더는 전부 리뷰 목록을 묻는다.
   * `@shopping/api-mocks` 에는 그 라우트의 핸들러가 아직 없어 요청이 대역에 닿지
   * 못하고, 그러면 「핸들러 없는 요청」으로 파일 전체가 실패한다 —
   * `test/support/reviews.ts` 가 그 자리를 대신하고, 왜 거기 있는지도 적혀 있다.
   */
  stubReviewApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('상품 상세 접근성', () => {
  it.each(DENSITY_LEVELS)('passes at density %s', async (level) => {
    await renderDetail(product.id, { density: level })

    await expectNoViolations()
  })

  it('passes on a phone, where the purchase bar is fixed', async () => {
    await renderDetail(product.id, { width: VIEWPORTS.mobile })

    await expectNoViolations()
  })

  it('passes with a combination chosen and another one refused', async () => {
    const user = userEvent.setup()
    await renderDetail()

    const colours = screen.getByRole('group', { name: '색상' })

    await user.click(within(colours).getByRole('button', { name: /^카멜/ }))

    // 카멜·L 과 카멜·XL 은 `aria-disabled` 로 남는다 — 이름을 잃지 않았는지가
    // 이 검사가 보는 것이다.
    await expectNoViolations()
  })

  it('passes with the gallery zoomed', async () => {
    const user = userEvent.setup()
    await renderDetail()

    await user.click(screen.getByRole('button', { name: copy.gallery.zoomIn }))

    await expectNoViolations()
  })

  it('passes for a product with no options and one image', async () => {
    await renderDetail(storefrontProductWithoutOptions.product.id)

    await expectNoViolations()
  })
})

describe('P4 키보드만으로', () => {
  it('reaches an option, the gallery and the purchase buttons by tabbing', async () => {
    const user = userEvent.setup()
    await renderDetail()

    const colours = screen.getByRole('group', { name: '색상' })
    const wanted = new Set<HTMLElement>([
      within(colours).getByRole('button', { name: /^아이보리/ }),
      screen.getByRole('button', { name: copy.gallery.next }),
      screen.getByRole('button', { name: copy.purchase.addToCart }),
      // `aria-disabled`, so it keeps its tab stop and the reason under it can be
      // read. A `disabled` button here would be a control nobody can ask about.
      screen.getByRole('button', { name: copy.purchase.buyNow }),
    ])

    for (let step = 0; step < 45 && wanted.size > 0; step += 1) {
      await user.tab()
      if (document.activeElement instanceof HTMLElement) wanted.delete(document.activeElement)
    }

    expect([...wanted]).toEqual([])
  })
})
