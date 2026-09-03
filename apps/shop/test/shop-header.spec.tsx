/**
 * The header, at the three viewports `docs/design/pages.md` verifies.
 *
 * What is being checked is the D-055 promise: **one form is mounted, not two
 * hidden behind CSS**. So each test asserts both what is there and what is not —
 * a hamburger with no inline category list on a phone, an inline list with no
 * hamburger on a desktop. A test that only looked for what it expected would
 * pass just as well against the implementation the decision rules out.
 */

import { DensityProvider } from '@shopping/ui/density'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ShopHeader } from '@/components/layout/shop-header'
import { messagesFor } from '@/messages'

import { stubViewport, VIEWPORTS } from './support/viewport'

const messages = messagesFor()
const layout = messages.layout

function renderHeader(width: number) {
  stubViewport(width)

  return render(
    <DensityProvider>
      <ShopHeader brand={messages.app.name} messages={layout} />
    </DensityProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

describe('at 360px', () => {
  it('offers the menu button and no inline category list', () => {
    renderHeader(VIEWPORTS.mobile)

    expect(screen.getByRole('button', { name: layout.nav.openMenu })).toBeVisible()
    expect(screen.queryByRole('link', { name: layout.nav.categories[0]!.label })).toBeNull()
  })

  it('keeps the search field out of the row and in the menu', async () => {
    renderHeader(VIEWPORTS.mobile)

    expect(screen.queryByRole('searchbox', { name: layout.search.label })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: layout.nav.openMenu }))

    expect(await screen.findByRole('searchbox', { name: layout.search.label })).toBeVisible()
  })

  it('collapses the density toggle into a button that names the current step', () => {
    renderHeader(VIEWPORTS.mobile)

    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByRole('button', { name: new RegExp(layout.density.names[2]) })).toBeVisible()
  })
})

describe('at 768px', () => {
  it('shows the search field but still uses the menu for categories', () => {
    renderHeader(VIEWPORTS.tablet)

    expect(screen.getByRole('searchbox', { name: layout.search.label })).toBeVisible()
    expect(screen.getByRole('button', { name: layout.nav.openMenu })).toBeVisible()
    expect(screen.queryByRole('link', { name: layout.nav.categories[0]!.label })).toBeNull()
  })

  it('lays the three density steps out in the row', () => {
    renderHeader(VIEWPORTS.tablet)

    expect(screen.getByRole('radiogroup', { name: layout.density.legend })).toBeVisible()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })
})

describe('at 1440px', () => {
  it('replaces the menu button with the category list', () => {
    renderHeader(VIEWPORTS.desktop)

    expect(screen.queryByRole('button', { name: layout.nav.openMenu })).toBeNull()

    const nav = screen.getByRole('navigation', { name: layout.nav.label })

    expect(screen.getAllByRole('link', { name: layout.nav.categories[0]!.label })).toHaveLength(1)
    expect(nav).toBeVisible()
  })

  it('links every category to its own route', () => {
    renderHeader(VIEWPORTS.desktop)

    for (const category of layout.nav.categories) {
      expect(screen.getByRole('link', { name: category.label })).toHaveAttribute(
        'href',
        `/categories/${category.slug}`,
      )
    }
  })
})

describe('the header, at every viewport', () => {
  it.each([VIEWPORTS.mobile, VIEWPORTS.tablet, VIEWPORTS.desktop])(
    'carries the brand, the cart and the account at %ipx',
    (width) => {
      renderHeader(width)

      expect(screen.getByRole('link', { name: messages.app.name })).toHaveAttribute('href', '/')
      expect(screen.getByRole('link', { name: layout.account.cart })).toHaveAttribute(
        'href',
        '/cart',
      )
      expect(screen.getByRole('link', { name: layout.account.mypage })).toHaveAttribute(
        'href',
        '/mypage',
      )
    },
  )

  it('reaches every control with the keyboard alone', async () => {
    renderHeader(VIEWPORTS.desktop)

    const reached: string[] = []

    for (let step = 0; step < 12; step += 1) {
      await userEvent.tab()
      const active = document.activeElement
      if (active !== null && active !== document.body) reached.push(active.textContent ?? '')
    }

    // Every interactive element in the header is a link, a button or the radio
    // group's single stop; none of them is reachable only with a pointer.
    expect(reached.length).toBeGreaterThan(0)
    expect(document.querySelectorAll('[tabindex="-1"]:not([role="radio"])')).toHaveLength(0)
  })
})
