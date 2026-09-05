/**
 * The phone's navigation sheet.
 *
 * The behaviours worth asserting are the ones a hand-written menu gets wrong:
 * that it opens and closes, that Escape closes it, that focus goes into it and
 * comes back to the button afterwards, and that choosing a category dismisses it
 * — the route changes underneath and Radix has no way to know that happened.
 */

import { storefrontCategoryTree } from '@shopping/api-mocks'
import { DensityProvider } from '@shopping/ui/density'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { MobileMenu } from '@/components/layout/mobile-menu'
import { resetCategoryMenuCache } from '@/lib/categories/use-category-menu'
import { messagesFor } from '@/messages'

import { stubViewport, VIEWPORTS } from './support/viewport'

const layout = messagesFor().layout

/**
 * The first root of the mock catalogue, and a child whose name is unique in it.
 *
 * 「아우터」 and 「상의」 hang under both 여성 and 남성, so a query by name alone
 * finds two links and fails on the ambiguity rather than on the behaviour.
 */
const ROOT = storefrontCategoryTree.nodes[0]!
const CHILD = ROOT.children.find((child) => child.slug === 'women-dress')!

beforeEach(() => {
  resetCategoryMenuCache()
})

function renderMenu() {
  stubViewport(VIEWPORTS.mobile)

  return render(
    <DensityProvider>
      <MobileMenu messages={layout} />
    </DensityProvider>,
  )
}

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: layout.nav.openMenu })
}

describe('the menu sheet', () => {
  it('starts closed, so nothing of it is in the page', () => {
    renderMenu()

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('link', { name: ROOT.name })).toBeNull()
  })

  it('opens with every category and the search field', async () => {
    renderMenu()

    await userEvent.click(trigger())

    const sheet = await screen.findByRole('dialog', { name: layout.nav.menuTitle })

    expect(sheet).toBeVisible()
    expect(screen.getByRole('combobox', { name: layout.search.label })).toBeVisible()

    // Two levels on the sheet (TASK-0042 R1): it has the height a header row
    // does not, and a phone menu that needs two taps to reach 코트 is a menu
    // people use the search field instead of.
    expect(await within(sheet).findByRole('link', { name: ROOT.name })).toHaveAttribute(
      'href',
      `/categories/${ROOT.slug}`,
    )
    expect(within(sheet).getByRole('link', { name: CHILD.name })).toHaveAttribute(
      'href',
      `/categories/${CHILD.slug}`,
    )
  })

  it('closes on Escape and gives the focus back to the button', async () => {
    renderMenu()

    await userEvent.click(trigger())
    await screen.findByRole('dialog')

    await userEvent.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(trigger()).toHaveFocus()
  })

  it('opens from the keyboard alone', async () => {
    renderMenu()

    await userEvent.tab()

    expect(trigger()).toHaveFocus()

    await userEvent.keyboard('{Enter}')

    expect(await screen.findByRole('dialog')).toBeVisible()
  })

  it('closes itself when a category is chosen', async () => {
    renderMenu()

    await userEvent.click(trigger())
    const link = await screen.findByRole('link', { name: ROOT.name })

    expect(link).toHaveAttribute('href', `/categories/${ROOT.slug}`)

    // The click is what a visitor does; jsdom has no router to follow the href,
    // and the assertion is about the sheet, which is this component's own job.
    await userEvent.click(link)

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })
})
