/**
 * axe over the home and the brand page (P2), and the nine combinations (F7).
 *
 * The home is where a visitor's first impression of the density feature is
 * formed, so all three steps are checked here rather than only on the screens
 * that were built to show them off.
 */

import { DENSITY_LEVELS, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { DensityProvider } from '@shopping/ui/density'
import { storefrontSeller } from '@shopping/api-mocks'
import { render, screen } from '@testing-library/react'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import HomePage from '@/app/page'
import { resetCategoryMenuCache } from '@/lib/categories/use-category-menu'
import { messagesFor } from '@/messages'

import { navigation } from './support/navigation'
import { renderWithAuth } from './support/auth'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const { default: BrandPage } = await import('@/app/brands/[sellerId]/page')

const messages = messagesFor()
const home = messages.home

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

function renderHome({
  density = 2,
  width = VIEWPORTS.desktop,
}: { density?: number; width?: number } = {}) {
  localStorage.setItem(DENSITY_STORAGE_KEY, String(density))
  document.documentElement.setAttribute('data-density', String(density))
  stubViewport(width)

  return renderWithAuth(
    <DensityProvider>
      <HomePage />
    </DensityProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  resetCategoryMenuCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('F7 아홉 조합 — 홈', () => {
  /**
   * 밀도 3 × 뷰포트 3. jsdom paints nothing, so 「깨짐」 cannot be measured as
   * pixels — what can be is that every combination is a *complete* page: the
   * hero, the shortcuts, and both product sections with rows in them.
   */
  it.each(
    DENSITY_LEVELS.flatMap((density) =>
      Object.entries(VIEWPORTS).map(([name, width]) => [density, name, width] as const),
    ),
  )('density %s at %s', async (density, _name, width) => {
    renderHome({ density, width })

    expect(screen.getByRole('heading', { level: 1, name: home.heroTitle })).toBeVisible()
    expect(
      await screen.findByRole('list', {
        name: home.gridLabel.replace('{title}', home.newTitle),
      }),
    ).toHaveAttribute('data-density', String(density))
    await screen.findByRole('navigation', { name: home.categoriesTitle })
  })
})

describe('홈 접근성', () => {
  it.each(DENSITY_LEVELS)('passes at density %s', async (level) => {
    renderHome({ density: level })

    await screen.findByRole('list', { name: home.gridLabel.replace('{title}', home.newTitle) })

    await expectNoViolations()
  })

  it('passes with the demo nudge showing', async () => {
    renderHome()

    expect(await screen.findByText(home.demo.title)).toBeVisible()

    await expectNoViolations()
  })
})

describe('브랜드관 접근성', () => {
  it('passes with the store header and its listings', async () => {
    stubViewport(VIEWPORTS.desktop)
    navigation.start(`/brands/${storefrontSeller.seller.id}`)

    render(
      <DensityProvider>
        {await BrandPage({ params: Promise.resolve({ sellerId: storefrontSeller.seller.id }) })}
      </DensityProvider>,
    )

    await screen.findByRole('list', { name: messages.search.list.gridLabel })

    await expectNoViolations()
  })
})
