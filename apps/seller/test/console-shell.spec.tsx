/**
 * This app's half of the console shell: its menu, its router, its slots.
 *
 * `packages/ui` already checks what the shell *does* — which form is mounted at
 * which width, where the focus goes, what the sub-route rule is. What can only
 * be checked here is that the menu handed to it is the one
 * `docs/design/pages.md` 2장 describes, that every entry leads to a route
 * this app actually has, and that the two reserved slots are controls rather
 * than dead ends.
 *
 * `usePathname` is the one thing mocked. There is no router in a unit test, and
 * the pathname is exactly the input the highlight rule takes.
 */

import { consoleMenuItems } from '@shopping/ui/console'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SellerShell } from '@/components/layout/seller-shell'
import { messagesFor } from '@/messages'

import { stubViewport, VIEWPORTS } from './support/viewport'

const { layout } = messagesFor()

const pathname = vi.hoisted(() => ({ current: '/' }))

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
}))

function renderShell(currentPath: string, width: number = VIEWPORTS.desktop) {
  pathname.current = currentPath
  stubViewport(width)

  return render(
    <SellerShell messages={layout}>
      <h1>{currentPath}</h1>
    </SellerShell>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the menu', () => {
  it('carries every entry from the route table, in order', () => {
    renderShell('/')

    const nav = screen.getByRole('navigation', { name: layout.shell.navLabel })

    for (const item of consoleMenuItems(layout.menu)) {
      expect(within(nav).getByRole('link', { name: item.label })).toHaveAttribute('href', item.href)
    }
  })

  it('leads to a route this app has', () => {
    // A menu entry pointing at a 404 is the defect the placeholder screens
    // exist to prevent (TASK-0019 4.10), and it is invisible until someone
    // clicks. The filesystem is the router here, so the filesystem is what is
    // asked.
    for (const item of consoleMenuItems(layout.menu)) {
      const segment = item.href === '/' ? '' : item.href
      expect(existsSync(join(import.meta.dirname, '..', 'src', 'app', segment, 'page.tsx'))).toBe(
        true,
      )
    }
  })

  it('marks the section a sub-route belongs to', () => {
    renderShell('/products/new')

    expect(screen.getByRole('link', { name: '상품 관리' })).toHaveAttribute('aria-current', 'page')
  })

  it('does not offer a display-density control anywhere (D-033)', () => {
    renderShell('/')

    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(document.querySelectorAll('[data-density]')).toHaveLength(0)
  })
})

describe('the reserved slots', () => {
  it.each([
    ['notifications', layout.notifications],
    ['account', layout.account],
  ])('%s says which milestone fills it, rather than being disabled', async (_name, slot) => {
    const user = userEvent.setup()
    renderShell('/')

    const trigger = screen.getByRole('button', { name: slot.label })

    expect(trigger).toBeEnabled()

    await user.click(trigger)

    expect(await screen.findByText(slot.body)).toBeVisible()
  })
})
