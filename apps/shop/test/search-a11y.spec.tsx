/**
 * axe over the search screen, in every state it can be in (P2).
 *
 * Worth its own gate for two things that only exist once the screen is
 * assembled. The **combobox** is one: `role="combobox"` obliges an
 * `aria-controls` that resolves, an `aria-activedescendant` naming an element
 * that is actually in the tree, and a listbox holding nothing but options — a
 * set of promises no component makes on its own. The **filter panel** is the
 * other: it is generated from data, so its labels, its disabled boxes and its
 * three densities are only ever seen together here.
 *
 * The rule set is the one this app's other a11y specs use, restated for the
 * reason `mypage-a11y.spec.tsx` gives — `packages/ui`'s copy is behind an
 * `exports` map that does not reach into `stories/`.
 */

import { SEARCH_COAT_CATEGORY } from '@shopping/api-mocks'
import { DENSITY_LEVELS, DENSITY_STORAGE_KEY } from '@shopping/ui'
import { DensityProvider } from '@shopping/ui/density'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { messagesFor } from '@/messages'

import { navigation, nextNavigationMock } from './support/navigation'
import { resetDensity } from './support/mypage'
import { stubViewport, VIEWPORTS } from './support/viewport'

vi.mock('next/navigation', () => nextNavigationMock())

const { default: SearchPage } = await import('@/app/search/page')

const messages = messagesFor().search
const box = messagesFor().layout.search

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

function renderSearch(href: string, width: number = VIEWPORTS.desktop) {
  stubViewport(width)
  navigation.start(href)

  return render(
    <DensityProvider>
      <SearchPage />
    </DensityProvider>,
  )
}

beforeEach(() => {
  resetDensity()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('검색 화면 접근성', () => {
  it('passes before anything has been searched for', async () => {
    renderSearch('/search')

    expect(screen.getByText(messages.promptTitle)).toBeVisible()

    await expectNoViolations()
  })

  it('passes with results, a generated panel and applied chips', async () => {
    renderSearch(`/search?categoryId=${String(SEARCH_COAT_CATEGORY)}&attr.fit=오버사이즈`)

    await screen.findByRole('list', { name: messages.list.gridLabel })
    // The disabled zero-count box is part of what is being checked: a control
    // that is `disabled` must still carry its name.
    await screen.findByRole('checkbox', { name: /루즈/ })

    await expectNoViolations()
  })

  it('passes with the suggestion list open and a candidate highlighted', async () => {
    const user = userEvent.setup()
    renderSearch('/search')

    const field = screen.getAllByRole('combobox', { name: box.label })[0]!

    await user.type(field, '코트')
    await within(await screen.findByRole('listbox', { name: box.suggestionsLabel })).findAllByRole(
      'option',
    )
    await user.keyboard('{ArrowDown}')

    await waitFor(() => {
      expect(field).toHaveAttribute('aria-activedescendant')
    })

    await expectNoViolations()
  })

  it('passes with nothing found', async () => {
    renderSearch('/search?q=존재하지않는검색어')

    expect(await screen.findByText(messages.list.emptyTitle)).toBeVisible()

    await expectNoViolations()
  })

  it('passes with the mobile filter sheet open', async () => {
    const user = userEvent.setup()
    renderSearch(`/search?categoryId=${String(SEARCH_COAT_CATEGORY)}`, VIEWPORTS.mobile)

    await user.click(await screen.findByRole('button', { name: messages.filters.openLabel }))
    await screen.findByRole('dialog')

    await expectNoViolations()
  })

  it.each(DENSITY_LEVELS)('passes at density %s', async (level) => {
    localStorage.setItem(DENSITY_STORAGE_KEY, String(level))
    document.documentElement.setAttribute('data-density', String(level))

    renderSearch(`/search?categoryId=${String(SEARCH_COAT_CATEGORY)}`)

    await screen.findByRole('list', { name: messages.list.gridLabel })

    await expectNoViolations()
  })
})
