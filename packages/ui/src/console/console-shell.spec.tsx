/**
 * The console shell, at the width it turns on.
 *
 * What is checked is the D-055 promise — **one form is mounted, not two hidden
 * behind CSS** — so each case asserts what is there *and* what is not: a column
 * with no sheet above 1024px, a sheet with no column below it. A test that only
 * looked for what it expected would pass against the implementation the
 * decision rules out.
 *
 * jsdom has no layout, so `matchMedia` is stubbed per test; that is also the
 * only way to say "this is a 1440px browser" here.
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConsoleShell } from './console-shell'
import type { ConsoleMenu } from './menu'
import { PageHeader } from './page-header'

const MENU: ConsoleMenu = [
  { id: 'overview', items: [{ href: '/', label: 'dashboard' }] },
  {
    id: 'sales',
    label: 'sales',
    items: [
      { href: '/products', label: 'products' },
      { href: '/orders', label: 'orders' },
    ],
  },
]

const LABELS = {
  closeNav: 'close menu',
  collapseSidebar: 'collapse sidebar',
  expandSidebar: 'expand sidebar',
  navLabel: 'main menu',
  navSheetDescription: 'every screen of the console',
  openNav: 'open menu',
  skipToContent: 'skip to content',
}

/** The three verification viewports of `docs/design/pages.md`. */
const VIEWPORTS = { desktop: 1440, mobile: 360, tablet: 768 } as const

function stubViewport(width: number): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      const minWidth = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0)

      return {
        addEventListener: () => undefined,
        addListener: () => undefined,
        dispatchEvent: () => false,
        matches: width >= minWidth,
        media: query,
        onchange: null,
        removeEventListener: () => undefined,
        removeListener: () => undefined,
      }
    }),
  )
}

function TestLink({
  href,
  children,
  ...props
}: {
  readonly href: string
  readonly children: ReactNode
  readonly className?: string
  readonly 'aria-current'?: 'page'
  readonly onClick?: () => void
}) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  )
}

function renderShell(width: number, currentPath = '/orders') {
  stubViewport(width)

  return render(
    <ConsoleShell
      brand="admin console"
      currentPath={currentPath}
      labels={LABELS}
      linkComponent={TestLink}
      menu={MENU}
    >
      <PageHeader title="orders" />
    </ConsoleShell>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('at 1440px', () => {
  it('puts the menu on screen without anything being opened', () => {
    renderShell(VIEWPORTS.desktop)

    const nav = screen.getByRole('navigation', { name: LABELS.navLabel })

    expect(within(nav).getByRole('link', { name: 'orders' })).toBeVisible()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('collapses and restores the column from the top bar', async () => {
    const user = userEvent.setup()
    renderShell(VIEWPORTS.desktop)

    await user.click(screen.getByRole('button', { name: LABELS.collapseSidebar }))

    expect(screen.queryByRole('navigation', { name: LABELS.navLabel })).toBeNull()

    await user.click(screen.getByRole('button', { name: LABELS.expandSidebar }))

    expect(screen.getByRole('navigation', { name: LABELS.navLabel })).toBeVisible()
  })
})

describe('below 1024px', () => {
  it.each([VIEWPORTS.mobile, VIEWPORTS.tablet])(
    'keeps the menu behind a sheet at %ipx',
    (width) => {
      renderShell(width)

      expect(screen.queryByRole('navigation', { name: LABELS.navLabel })).toBeNull()
      expect(screen.getByRole('button', { name: LABELS.openNav })).toBeVisible()
    },
  )

  it('opens the sheet, then closes it when a destination is chosen', async () => {
    const user = userEvent.setup()
    renderShell(VIEWPORTS.mobile)

    await user.click(screen.getByRole('button', { name: LABELS.openNav }))

    const sheet = await screen.findByRole('dialog')

    expect(within(sheet).getByRole('link', { name: 'products' })).toBeVisible()

    await user.click(within(sheet).getByRole('link', { name: 'products' }))

    // The route changes under the sheet; Radix has no reason to know that.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('returns focus to the toggle after the sheet closes', async () => {
    const user = userEvent.setup()
    renderShell(VIEWPORTS.mobile)

    const toggle = screen.getByRole('button', { name: LABELS.openNav })

    await user.click(toggle)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')

    expect(toggle).toHaveFocus()
  })
})

describe('the menu', () => {
  it('marks the entry the current path belongs to', () => {
    renderShell(VIEWPORTS.desktop, '/products/new')

    expect(screen.getByRole('link', { name: 'products' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'orders' })).not.toHaveAttribute('aria-current')
  })

  it('does not light the dashboard on every screen', () => {
    renderShell(VIEWPORTS.desktop, '/orders')

    expect(screen.getByRole('link', { name: 'dashboard' })).not.toHaveAttribute('aria-current')
  })

  it('names the current section in the top bar, and the console outside it', () => {
    // Located through the toggle rather than by role: `PageHeader` renders a
    // `<header>` of its own inside `<main>`, and the query would be ambiguous.
    const topbar = () =>
      screen.getByRole('button', { name: LABELS.collapseSidebar }).closest('header')

    renderShell(VIEWPORTS.desktop, '/products/new')
    expect(topbar()).toHaveTextContent('products')

    cleanup()

    renderShell(VIEWPORTS.desktop, '/components')
    expect(topbar()).toHaveTextContent('admin console')
  })
})

describe('the keyboard', () => {
  it('reaches the content before the menu, and every entry after it', async () => {
    const user = userEvent.setup()
    renderShell(VIEWPORTS.desktop)

    await user.tab()

    expect(screen.getByRole('link', { name: LABELS.skipToContent })).toHaveFocus()
    expect(screen.getByRole('link', { name: LABELS.skipToContent })).toHaveAttribute(
      'href',
      '#console-main',
    )

    const reached: (Element | null)[] = []
    for (let step = 0; step < 8; step += 1) {
      await user.tab()
      reached.push(document.activeElement)
    }

    for (const label of ['dashboard', 'products', 'orders']) {
      expect(reached).toContain(screen.getByRole('link', { name: label }))
    }
  })

  it('focuses the content itself when the skip link is followed', () => {
    renderShell(VIEWPORTS.desktop)

    // The fragment moves the scroll position; `tabindex="-1"` is what moves the
    // focus, and without it the next Tab goes back into the menu.
    expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1')
  })
})
