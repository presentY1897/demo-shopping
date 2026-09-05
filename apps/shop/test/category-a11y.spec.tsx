/**
 * axe over the category screen and the header menu it added (P2).
 *
 * The list below the heading is the search screen's own component and
 * `search-a11y.spec.tsx` is its gate. What is new here — and what this file is
 * for — is the *frame*: a breadcrumb whose last item is not a link, a shortcut
 * nav that shares the page with two other navs, and a header dropdown per
 * category. Three navigation landmarks on one page is exactly the arrangement
 * `landmark-unique` fails when one of them is unnamed.
 *
 * The rule set is this app's, restated for the reason `mypage-a11y.spec.tsx`
 * gives — `packages/ui`'s copy is behind an `exports` map that does not reach
 * into `stories/`.
 */

import { storefrontCategoryTree } from '@shopping/api-mocks'
import { DENSITY_LEVELS, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { DensityProvider } from '@shopping/ui/density'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShopHeader } from '@/components/layout/shop-header'
import { resetCategoryMenuCache } from '@/lib/categories/use-category-menu'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { navigation } from './support/navigation'
import { resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'

/**
 * The factory imports its own dependency.
 *
 * `vi.mock` is hoisted above every import in the file, so a factory that closes
 * over a top-level binding runs before that binding exists — which surfaces as
 * `Cannot access '__vi_import_N__' before initialization`, blamed on whichever
 * component imported `next/navigation` first. An async factory with its own
 * `import` is evaluated when the mock is first needed, by which time it is.
 */
vi.mock('next/navigation', async () => {
  const { nextNavigationMock } = await import('./support/navigation')

  return nextNavigationMock()
})

const { default: CategoryPage } = await import('@/app/categories/[slug]/page')

const messages = messagesFor()
const search = messages.search

const ROOT = storefrontCategoryTree.nodes[0]!
const SECTION = ROOT.children[0]!
const LEAF = SECTION.children[0]!

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

async function renderCategory(slug: string, width: number = VIEWPORTS.desktop) {
  stubViewport(width)
  navigation.start(`/categories/${slug}`)

  return render(
    <DensityProvider>{await CategoryPage({ params: Promise.resolve({ slug }) })}</DensityProvider>,
  )
}

beforeEach(() => {
  resetDensity()
  resetCategoryMenuCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('카테고리 화면 접근성', () => {
  it('passes with a lineage, shortcuts and results', async () => {
    await renderCategory(SECTION.slug)

    await screen.findByRole('list', { name: search.list.gridLabel })

    await expectNoViolations()
  })

  it('passes at a leaf, where there are no shortcuts to draw', async () => {
    await renderCategory(LEAF.slug)

    await screen.findByRole('list', { name: search.list.gridLabel })

    await expectNoViolations()
  })

  it('passes with the mobile filter sheet open', async () => {
    const user = userEvent.setup()
    await renderCategory(LEAF.slug, VIEWPORTS.mobile)

    await user.click(await screen.findByRole('button', { name: search.filters.openLabel }))
    await screen.findByRole('dialog')

    await expectNoViolations()
  })

  it.each(DENSITY_LEVELS)('passes at density %s', async (level) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, String(level))
    document.documentElement.setAttribute('data-density', String(level))

    await renderCategory(LEAF.slug)
    await screen.findByRole('list', { name: search.list.gridLabel })

    await expectNoViolations()
  })
})

describe('헤더 카테고리 메뉴 접근성', () => {
  it('passes with a category dropdown open', async () => {
    const user = userEvent.setup()
    stubViewport(VIEWPORTS.desktop)

    renderWithAuth(
      <DensityProvider>
        <ShopHeader brand={messages.app.name} messages={messages.layout} />
      </DensityProvider>,
    )

    await user.click(await screen.findByRole('button', { name: ROOT.name }))
    await screen.findByRole('dialog', { name: ROOT.name })

    await expectNoViolations()
  })

  it('passes with the phone menu open, two levels deep', async () => {
    const user = userEvent.setup()
    stubViewport(VIEWPORTS.mobile)

    renderWithAuth(
      <DensityProvider>
        <ShopHeader brand={messages.app.name} messages={messages.layout} />
      </DensityProvider>,
    )

    await user.click(screen.getByRole('button', { name: messages.layout.nav.openMenu }))
    await screen.findByRole('dialog', { name: messages.layout.nav.menuTitle })
    await screen.findByRole('link', { name: ROOT.name })

    await expectNoViolations()
  })
})

describe('P4 키보드만으로', () => {
  it('reaches the lineage, a shortcut, a filter and a result by tabbing', async () => {
    const user = userEvent.setup()
    await renderCategory(SECTION.slug)

    const list = await screen.findByRole('list', { name: search.list.gridLabel })
    // The stock switch rather than an attribute facet: a *section* has no
    // attribute filters of its own — definitions hang on the leaf, and the API
    // gathers them down the path to the category asked for, not up from below.
    // Price and stock are on every listing, so the panel always has these two.
    const stock = await screen.findByRole('checkbox', { name: search.filters.inStock })
    const wanted = new Set<HTMLElement>([
      screen.getByRole('link', { name: ROOT.name }),
      screen.getByRole('link', { name: LEAF.name }),
      stock,
      ...[list.querySelector('a')].filter((node): node is HTMLAnchorElement => node !== null),
    ])

    // Bounded: the breadcrumb, the shortcuts, the panel and the cards. Anything
    // not reached inside forty stops is not reachable.
    for (let step = 0; step < 40 && wanted.size > 0; step += 1) {
      await user.tab()
      if (document.activeElement instanceof HTMLElement) wanted.delete(document.activeElement)
    }

    expect([...wanted]).toEqual([])
  })

  it('reaches an attribute facet on a leaf, where the definitions live', async () => {
    const user = userEvent.setup()
    await renderCategory(LEAF.slug)

    const facet = await screen.findByRole('checkbox', { name: /오버사이즈/ })

    for (let step = 0; step < 40 && document.activeElement !== facet; step += 1) {
      await user.tab()
    }

    expect(document.activeElement).toBe(facet)
  })
})
