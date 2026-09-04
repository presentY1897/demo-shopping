/**
 * This app's half of the console shell: its menu, its router, its slots.
 *
 * `packages/ui` already checks what the shell *does* — which form is mounted at
 * which width, where the focus goes, what the sub-route rule is. What can only
 * be checked here is that the menu handed to it is the one
 * `docs/design/pages.md` 3장 describes, that every entry leads to a route
 * this app actually has, and that the two reserved slots are controls rather
 * than dead ends.
 *
 * `usePathname` is the one thing mocked. There is no router in a unit test, and
 * the pathname is exactly the input the highlight rule takes.
 */

import { consoleMenuItems } from '@shopping/ui/console'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminShell } from '@/components/layout/admin-shell'
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
    <AdminShell messages={layout}>
      <h1>{currentPath}</h1>
    </AdminShell>,
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
    renderShell('/categories')

    expect(screen.getByRole('link', { name: '카테고리 관리' })).toHaveAttribute(
      'aria-current',
      'page',
    )
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

/**
 * The rule set `categories-a11y.spec.tsx` uses, minus the two exclusions that
 * only make sense for a screen rendered without its shell. Here the shell *is*
 * the subject, so `region` and `landmark-one-main` are switched back on: a
 * console whose sidebar is not in a landmark, or whose content is not in
 * `<main>`, is exactly the defect worth catching.
 */
const A11Y: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    // jsdom paints nothing, so axe cannot decide contrast. `packages/ui`
    // converts the OKLCH palette and fails below 4.5:1 over more pairs than a
    // screen would exercise.
    'color-contrast': { enabled: false },
    // The document shell — lang, title — belongs to `app/layout.tsx`, which is
    // not rendered here.
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
  },
}

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, A11Y)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

describe('the shell has no accessibility violations', () => {
  it('with the sidebar column open', async () => {
    renderShell('/categories')

    await expectNoViolations()
  })

  it('with the sidebar collapsed', async () => {
    const user = userEvent.setup()
    renderShell('/categories')

    await user.click(screen.getByRole('button', { name: layout.shell.collapseSidebar }))

    await expectNoViolations()
  })

  it('with the sheet open on a phone', async () => {
    const user = userEvent.setup()
    renderShell('/categories', VIEWPORTS.mobile)

    await user.click(screen.getByRole('button', { name: layout.shell.openNav }))
    await screen.findByRole('dialog')

    await expectNoViolations()
  })

  it('with a top-bar slot open', async () => {
    const user = userEvent.setup()
    renderShell('/categories')

    await user.click(screen.getByRole('button', { name: layout.account.label }))
    await screen.findByText(layout.account.body)

    await expectNoViolations()
  })
})
