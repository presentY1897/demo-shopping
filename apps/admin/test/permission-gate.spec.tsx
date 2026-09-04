/**
 * The permission hook, where it actually bites (TASK-0023 F8 · F9 · P2 · P4).
 *
 * **Not a made-up example.** `DELETE /categories/:id` and `DELETE
 * /attributes/:id` require `catalog.delete`, and `role-permissions.ts` gives
 * `ADMIN_OPERATOR` and `DEMO_ADMIN` `catalog.write` without it. So the two
 * buttons below are the exact places where an operator's console would otherwise
 * look alive and answer 403 — which is the failure the hook exists to prevent.
 *
 * The decision itself is not re-tested here. `authorizePermission` is
 * `@shopping/shared`'s and has its own branch-covered spec; what this file
 * checks is that the screen asks it, and that the answer reaches the reader in a
 * form they can get to with a keyboard.
 */

import { sessionAdminOperator, sessionAdminSuper, sessionDemoAdmin } from '@shopping/api-mocks'
import { consoleMenuItems } from '@shopping/ui/console'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { describe, expect, it, vi } from 'vitest'

import AttributesPage from '@/app/attributes/page'
import CategoriesPage from '@/app/categories/page'
import { AdminShell } from '@/components/layout/admin-shell'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { stubViewport, VIEWPORTS } from './support/viewport'

const messages = messagesFor()
const { auth, categories: categoryCopy, attributes: attributeCopy, layout } = messages

vi.mock('next/navigation', () => ({ usePathname: () => '/categories' }))

/** Opens the category console and selects a leaf, which is what 삭제 acts on. */
async function selectLeaf(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByRole('tree', { name: categoryCopy.treeLabel })

  const leaf = screen
    .getAllByRole('treeitem')
    .find((node) => node.getAttribute('aria-level') === '3')

  await user.click(leaf!)
}

describe('the category console — 삭제 (F9)', () => {
  it('is a live button for the role that holds catalog.delete', async () => {
    const user = userEvent.setup()
    renderWithAuth(<CategoriesPage />, { session: sessionAdminSuper })
    await selectLeaf(user)

    const remove = screen.getByRole('button', { name: categoryCopy.actions.remove })

    expect(remove).not.toHaveAttribute('aria-disabled')
    expect(remove).toBeEnabled()
  })

  it.each([
    ['an operator', sessionAdminOperator],
    ['a demo administrator', sessionDemoAdmin],
  ])('is blocked for %s, and says why', async (_name, session) => {
    const user = userEvent.setup()
    renderWithAuth(<CategoriesPage />, { session })
    await selectLeaf(user)

    const remove = await screen.findByRole('button', { name: categoryCopy.actions.remove })

    expect(remove).toHaveAttribute('aria-disabled', 'true')
    expect(remove).toHaveAccessibleDescription(auth.denials.missing_permission)
  })

  /**
   * The property `disabled` would have lost. A control the keyboard cannot reach
   * cannot explain itself, and the person who most needs the explanation is the
   * one who cannot see that it is greyed out.
   */
  it('stays reachable and inert while blocked (P4)', async () => {
    const user = userEvent.setup()
    renderWithAuth(<CategoriesPage />, { session: sessionAdminOperator })
    await selectLeaf(user)

    const remove = await screen.findByRole('button', { name: categoryCopy.actions.remove })
    remove.focus()
    expect(remove).toHaveFocus()

    await user.keyboard('{Enter}')

    // No confirmation dialog: the click never reached a handler.
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('the attribute console — 삭제 (F9)', () => {
  it('is blocked for an operator, with the same sentence', async () => {
    renderWithAuth(<AttributesPage />, { session: sessionAdminOperator })

    const remove = (await screen.findAllByRole('button', { name: attributeCopy.actions.remove }))[0]

    expect(remove).toHaveAttribute('aria-disabled', 'true')
    expect(remove).toHaveAccessibleDescription(auth.denials.missing_permission)
  })

  it('is live for the role that holds the permission', async () => {
    renderWithAuth(<AttributesPage />, { session: sessionAdminSuper })

    const remove = (await screen.findAllByRole('button', { name: attributeCopy.actions.remove }))[0]

    expect(remove).not.toHaveAttribute('aria-disabled')
  })
})

/**
 * **The measured fact, recorded rather than dressed up.**
 *
 * The sidebar is filtered by permission, and today it hides nothing: every role
 * that can open this console holds every `*.read` the menu asks for, because
 * `DEMO_ADMIN` narrows only its writes (`role-permissions.ts`). The filter is
 * still there — `packages/ui`'s `filterConsoleMenu` spec proves it removes what
 * it is told to — and this is the honest statement of what it does *here*.
 */
describe('the sidebar filter (F8)', () => {
  it.each([
    ['an operator', sessionAdminOperator],
    ['a demo administrator', sessionDemoAdmin],
  ])('hides nothing from %s, because nothing is out of reach today', async (_name, session) => {
    stubViewport(VIEWPORTS.desktop)
    renderWithAuth(
      <AdminShell messages={layout}>
        <h1>x</h1>
      </AdminShell>,
      { session },
    )

    // Wait for the session, so the assertion is about the filtered menu rather
    // than about the unfiltered one shown while it is unknown.
    await screen.findByRole('button', { name: auth.menu.label })
    const nav = screen.getByRole('navigation', { name: layout.shell.navLabel })

    for (const item of consoleMenuItems(layout.menu)) {
      expect(within(nav).getByRole('link', { name: item.label })).toBeVisible()
    }
  })
})

const A11Y: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    'color-contrast': { enabled: false },
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    region: { enabled: false },
  },
}

describe('a screen with a blocked control has no accessibility violations (P2)', () => {
  it('with the category toolbar showing a refusal', async () => {
    const user = userEvent.setup()
    renderWithAuth(<CategoriesPage />, { session: sessionAdminOperator })
    await selectLeaf(user)
    await screen.findByRole('button', { name: categoryCopy.actions.remove })

    const results = await axe.run(document.body, A11Y)

    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
  })
})
