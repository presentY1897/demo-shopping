/**
 * The phone's navigation sheet.
 *
 * The behaviours worth asserting are the ones a hand-written menu gets wrong:
 * that it opens and closes, that Escape closes it, that focus goes into it and
 * comes back to the button afterwards, and that choosing a category dismisses it
 * — the route changes underneath and Radix has no way to know that happened.
 */

import { DensityProvider } from '@shopping/ui/density'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { MobileMenu } from '@/components/layout/mobile-menu'
import { messagesFor } from '@/messages'

import { stubViewport, VIEWPORTS } from './support/viewport'

const layout = messagesFor().layout

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
    expect(screen.queryByRole('link', { name: layout.nav.categories[0]!.label })).toBeNull()
  })

  it('opens with every category and the search field', async () => {
    renderMenu()

    await userEvent.click(trigger())

    const sheet = await screen.findByRole('dialog', { name: layout.nav.menuTitle })

    expect(sheet).toBeVisible()
    expect(screen.getAllByRole('link')).toHaveLength(layout.nav.categories.length)
    expect(screen.getByRole('searchbox', { name: layout.search.label })).toBeVisible()
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
    const link = await screen.findByRole('link', { name: layout.nav.categories[0]!.label })

    expect(link).toHaveAttribute('href', `/categories/${layout.nav.categories[0]!.slug}`)

    // The click is what a visitor does; jsdom has no router to follow the href,
    // and the assertion is about the sheet, which is this component's own job.
    await userEvent.click(link)

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })
})
