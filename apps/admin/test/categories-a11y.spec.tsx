/**
 * axe over `/categories`, in every state it can be in.
 *
 * `packages/ui` runs the same engine over every story
 * (`packages/ui/test/story-a11y.spec.tsx`) — but a component that is accessible
 * on its own is not a screen that is accessible: the tree's roving `tabindex`,
 * its `aria-level`/`aria-posinset` bookkeeping and the dialogs' focus traps only
 * exist once they are assembled here. This is the gate for the assembly.
 *
 * P1 (LCP) and P2 (Lighthouse Accessibility) still need a real browser and are
 * not claimed by this file; what it does claim is that nothing axe can decide
 * structurally is wrong — names, roles, relationships, duplicate ids, and the
 * nested-interactive rule that decided where this screen's buttons live.
 */

import {
  categoryTreeEmpty,
  mockPaths,
  networkFailureOn,
  resetCategoryStore,
} from '@shopping/api-mocks'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { describe, expect, it } from 'vitest'

import CategoriesPage from '@/app/categories/page'
import { messagesFor } from '@/messages'

import { renderWithAuth } from './support/auth'
import { testServer } from './setup'

const { categories: copy } = messagesFor()

/**
 * The rule set, restated rather than imported.
 *
 * `packages/ui/stories/support/a11y.ts` holds the same list, but the package's
 * `exports` map does not reach into `stories/`, and that package belongs to
 * TASK-0017 right now. Keeping the two in step is worth a note in the report;
 * inventing a different bar would not be.
 */
const OPTIONS: RunOptions = {
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
    // Dialogs and toasts render through portals, outside this page's `<main>`.
    region: { enabled: false },
  },
}

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

describe('the category console has no accessibility violations', () => {
  it('while the tree is loading', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.categories))
    renderWithAuth(<CategoriesPage />)

    await expectNoViolations()
  })

  it('when the tree has arrived', async () => {
    renderWithAuth(<CategoriesPage />)
    await screen.findByRole('tree', { name: copy.treeLabel })

    await expectNoViolations()
  })

  it('when there is nothing to show', async () => {
    resetCategoryStore(categoryTreeEmpty)
    renderWithAuth(<CategoriesPage />)
    await screen.findByText(copy.emptyTitle)

    await expectNoViolations()
  })

  it('when the API refused', async () => {
    testServer.server.use(networkFailureOn('get', mockPaths.categories))
    renderWithAuth(<CategoriesPage />)
    await screen.findByText(copy.errorTitle)

    await expectNoViolations()
  })

  it('with a row selected and the toolbar live', async () => {
    const user = userEvent.setup()
    renderWithAuth(<CategoriesPage />)
    await screen.findByRole('tree', { name: copy.treeLabel })

    await user.click(screen.getAllByRole('treeitem')[0]!)

    await expectNoViolations()
  })

  it('with the add form open', async () => {
    const user = userEvent.setup()
    renderWithAuth(<CategoriesPage />)
    await screen.findByRole('tree', { name: copy.treeLabel })

    await user.click(screen.getByRole('button', { name: copy.actions.addRoot }))
    await screen.findByRole('dialog')

    await expectNoViolations()
  })

  it('with a field error showing', async () => {
    const user = userEvent.setup()
    renderWithAuth(<CategoriesPage />)
    await screen.findByRole('tree', { name: copy.treeLabel })

    await user.click(screen.getByRole('button', { name: copy.actions.addRoot }))
    await user.click(await screen.findByRole('button', { name: copy.form.save }))
    await screen.findByText(copy.form.errors.nameRequired)

    await expectNoViolations()
  })

  it('with the delete confirmation open', async () => {
    const user = userEvent.setup()
    renderWithAuth(<CategoriesPage />)
    await screen.findByRole('tree', { name: copy.treeLabel })

    const leaf = screen
      .getAllByRole('treeitem')
      .find((node) => node.getAttribute('aria-level') === '3')

    await user.click(leaf!)
    await user.click(screen.getByRole('button', { name: copy.actions.remove }))
    await screen.findByRole('dialog')

    await expectNoViolations()
  })

  it('with a toast announcing a failure', async () => {
    const user = userEvent.setup()
    renderWithAuth(<CategoriesPage />)
    const tree = await screen.findByRole('tree', { name: copy.treeLabel })

    testServer.server.use(networkFailureOn('post', mockPaths.categoryReorder))
    const [first] = screen.getAllByRole('treeitem')
    first?.focus()
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
    await screen.findByText(copy.toast.moveFailed)

    expect(tree).toBeVisible()
    await expectNoViolations()
  })
})
