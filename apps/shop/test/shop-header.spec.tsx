/**
 * The header, at the three viewports `docs/design/pages.md` verifies.
 *
 * What is being checked is the D-055 promise: **one form is mounted, not two
 * hidden behind CSS**. So each test asserts both what is there and what is not —
 * a hamburger with no inline category list on a phone, an inline list with no
 * hamburger on a desktop. A test that only looked for what it expected would
 * pass just as well against the implementation the decision rules out.
 */

import { storefrontCategoryTree } from '@shopping/api-mocks'
import { DensityProvider } from '@shopping/ui/density'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ShopHeader } from '@/components/layout/shop-header'
import { forgetCartCount, publishCartCount } from '@/lib/cart/cart-count'
import { resetCategoryMenuCache } from '@/lib/categories/use-category-menu'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { stubViewport, VIEWPORTS } from './support/viewport'

const messages = messagesFor()
const layout = messages.layout

function renderHeader(width: number) {
  stubViewport(width)

  return renderWithAuth(
    <DensityProvider>
      <ShopHeader brand={messages.app.name} messages={layout} />
    </DensityProvider>,
  )
}

/** The first root of the mock catalogue, and one of its grandchildren. */
const ROOT = storefrontCategoryTree.nodes[0]!
const LEAF = ROOT.children[0]!.children[0]!

beforeEach(() => {
  localStorage.clear()
  resetCategoryMenuCache()
})

afterEach(() => {
  localStorage.clear()
})

describe('at 360px', () => {
  it('offers the menu button and no inline category list', () => {
    renderHeader(VIEWPORTS.mobile)

    expect(screen.getByRole('button', { name: layout.nav.openMenu })).toBeVisible()
    expect(screen.queryByRole('button', { name: ROOT.name })).toBeNull()
  })

  it('keeps the search field out of the row and in the menu', async () => {
    renderHeader(VIEWPORTS.mobile)

    // `combobox`, not `searchbox`: TASK-0041 gave the field an autocomplete
    // list, and the ARIA pattern for that puts `role="combobox"` on the input.
    expect(screen.queryByRole('combobox', { name: layout.search.label })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: layout.nav.openMenu }))

    expect(await screen.findByRole('combobox', { name: layout.search.label })).toBeVisible()
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

    expect(screen.getByRole('combobox', { name: layout.search.label })).toBeVisible()
    expect(screen.getByRole('button', { name: layout.nav.openMenu })).toBeVisible()
    expect(screen.queryByRole('button', { name: ROOT.name })).toBeNull()
  })

  it('lays the three density steps out in the row', () => {
    renderHeader(VIEWPORTS.tablet)

    expect(screen.getByRole('radiogroup', { name: layout.density.legend })).toBeVisible()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })
})

describe('at 1440px', () => {
  it('replaces the menu button with the category list', async () => {
    renderHeader(VIEWPORTS.desktop)

    expect(screen.queryByRole('button', { name: layout.nav.openMenu })).toBeNull()
    expect(screen.getByRole('navigation', { name: layout.nav.label })).toBeVisible()

    // The list arrives from the API rather than from the message catalog
    // (TASK-0042): the header is on every route, so reading it during the
    // server render would make the whole storefront dynamic.
    expect(await screen.findByRole('button', { name: ROOT.name })).toBeVisible()
  })

  it('opens one root and offers its children and its own page (R1)', async () => {
    renderHeader(VIEWPORTS.desktop)

    await userEvent.click(await screen.findByRole('button', { name: ROOT.name }))

    const panel = await screen.findByRole('dialog', { name: ROOT.name })
    const all = messagesFor().category.allOfLabel.replace('{name}', ROOT.name)

    expect(within(panel).getByRole('link', { name: all })).toHaveAttribute(
      'href',
      `/categories/${ROOT.slug}`,
    )
    expect(within(panel).getByRole('link', { name: ROOT.children[0]!.name })).toHaveAttribute(
      'href',
      `/categories/${ROOT.children[0]!.slug}`,
    )

    // Two levels, and no more: 40 categories over three is a menu nobody reads.
    expect(within(panel).queryByRole('link', { name: LEAF.name })).toBeNull()
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
      // The account slot is a menu since TASK-0023 — `/mypage` is its first
      // entry rather than the header's own link, because a fourth control in
      // the row overflows a 360px header.
      expect(screen.getByRole('button', { name: messages.auth.menu.label })).toBeVisible()
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

describe('장바구니 배지 (TASK-0046)', () => {
  beforeEach(() => {
    forgetCartCount()
  })

  it('says nothing until the count is known', () => {
    // `0` 과 「아직 안 읽었다」를 같게 두면 로그인 직후의 한순간에 「0」이 보이고,
    // 담아 둔 것이 있는 사람에게 그것은 거짓말이다.
    renderHeader(VIEWPORTS.desktop)

    expect(screen.getByRole('link', { name: layout.account.cart })).toBeVisible()
  })

  it('puts the count into the link’s own name', async () => {
    renderHeader(VIEWPORTS.desktop)

    publishCartCount(3)

    // 배지는 `aria-hidden` 이고 수는 링크의 이름에 들어간다 — 아이콘 옆의 작은
    // 숫자를 따로 읽어 주면 「장바구니」 「3」 두 덩어리로 들린다.
    expect(await screen.findByRole('link', { name: `${layout.account.cart} 3` })).toHaveAttribute(
      'href',
      '/cart',
    )
  })

  it('drops the badge again when the cart empties', async () => {
    renderHeader(VIEWPORTS.desktop)

    publishCartCount(2)
    await screen.findByRole('link', { name: `${layout.account.cart} 2` })

    publishCartCount(0)

    expect(await screen.findByRole('link', { name: layout.account.cart })).toBeVisible()
  })
})
