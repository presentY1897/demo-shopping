/**
 * axe over 상품 목록 · 재고 관리, in every state the two screens can be in
 * (QUALITY-GATES 2장 P2 · P3 · P4, TASK-0116 6.2).
 *
 * **This is the gate, and it is a substitute.** These screens cannot be opened
 * in a browser yet, so Lighthouse cannot be run against them; TASK-0109 · 0110 ·
 * 0112 · 0114 all hit the same wall and all measured accessibility by running
 * the same engine over the assembled screen. This does the same.
 *
 * **A set of accessible components is not an accessible screen.** The table's
 * per-row checkboxes have no visible label, the adjustment cell wires three
 * controls and an error to one row, and the bulk bar appears and disappears
 * under the filter — none of that exists until it is assembled here.
 *
 * The rule set is `product-editor-a11y.spec.tsx`'s, for the reason that file
 * gives.
 */

import { sellerProductId, sellerVariants } from '@shopping/api-mocks'
import { render, screen, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import type { RunOptions } from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ProductsPage from '@/app/products/page'
import StockPage from '@/app/products/[id]/stock/page'
import { messagesFor } from '@/messages'

import { stubViewport, VIEWPORTS } from './support/viewport'

const list = messagesFor().productList
const stock = messagesFor().productStock

const OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
  rules: {
    // jsdom paints nothing, so axe cannot decide contrast.
    'color-contrast': { enabled: false },
    // The document shell — lang, title — belongs to `app/layout.tsx`.
    'html-has-lang': { enabled: false },
    'document-title': { enabled: false },
    // The console's `<main>` is the shell's, and the shell is not in this tree.
    region: { enabled: false },
  },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function expectNoViolations(): Promise<void> {
  const results = await axe.run(document.body, OPTIONS)

  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
}

async function openList(): Promise<HTMLElement> {
  render(<ProductsPage />)

  return screen.findByRole('table', { name: list.table.caption })
}

async function openStock(): Promise<HTMLElement> {
  render(await StockPage({ params: Promise.resolve({ id: sellerProductId(3) }) }))

  return screen.findByRole('table', { name: stock.caption })
}

describe('the product list has no accessibility violations', () => {
  it('while the page is being read', async () => {
    render(<ProductsPage />)

    await expectNoViolations()
  })

  it('with rows, filters and pagination on screen', async () => {
    await openList()

    await expectNoViolations()
  })

  it('with rows selected and the bulk bar open', async () => {
    const user = userEvent.setup()
    const table = await openList()
    const [first] = within(table).getAllByRole('row').slice(1)

    if (first === undefined) throw new Error('행이 없습니다.')

    await user.click(within(first).getByRole('checkbox'))

    await expectNoViolations()
  })

  it('with the confirmation dialog open', async () => {
    const user = userEvent.setup()
    const table = await openList()
    const [first] = within(table).getAllByRole('row').slice(1)

    if (first === undefined) throw new Error('행이 없습니다.')

    await user.click(within(first).getByRole('button', { name: list.table.duplicate }))
    await screen.findByText(list.duplicate.draftNotice)

    await expectNoViolations()
  })
})

describe('the stock screen has no accessibility violations', () => {
  it('with the adjustment controls on every row', async () => {
    await openStock()

    await expectNoViolations()
  })

  it('with a field error showing', async () => {
    const user = userEvent.setup()
    const table = await openStock()
    const label = sellerVariants(3)[0]?.optionLabel ?? ''
    const row = within(table).getByText(label).closest('tr')

    if (row === null) throw new Error('행이 없습니다.')

    await user.click(within(row).getByRole('button', { name: stock.adjust.apply }))
    await within(row).findByRole('alert')

    await expectNoViolations()
  })

  it('with the history open', async () => {
    const user = userEvent.setup()
    const table = await openStock()
    const label = sellerVariants(3)[0]?.optionLabel ?? ''
    const row = within(table).getByText(label).closest('tr')

    if (row === null) throw new Error('행이 없습니다.')

    await user.click(
      within(row).getByRole('button', { name: stock.ledger.openLabel.replace('{option}', label) }),
    )
    await screen.findByRole('table', { name: stock.ledger.caption })

    await expectNoViolations()
  })
})

describe('P3 — the three viewports', () => {
  it.each(Object.entries(VIEWPORTS))(
    'renders the list at %s without violations',
    async (_name, width) => {
      stubViewport(width)
      await openList()

      await expectNoViolations()
    },
  )

  it('keeps the table scrollable rather than letting the page scroll sideways', async () => {
    stubViewport(VIEWPORTS.mobile)

    const table = await openList()
    const scroller = table.closest('[class*="overflow-x"]')

    // TASK-0016's Table owns the scroller and the pinned first column; the
    // screen's job is to have asked for them.
    expect(scroller).not.toBeNull()
  })
})

describe('P4 — Tab reaches everything', () => {
  /**
   * Tabs until the wanted control has focus, forwards then backwards.
   *
   * Both directions, because the bulk bar sits **above** the table — which is
   * where a toolbar over a table belongs, and which means a seller who has just
   * ticked a row reaches it with Shift+Tab, not Tab. A forward-only check would
   * have called that a failure and pushed the bar below the rows to satisfy
   * itself.
   */
  async function tabUntil(user: UserEvent, matches: () => Element | null): Promise<Element> {
    for (const shift of [false, true]) {
      // Twenty rows carry four focusables each, so a full circuit is ~90 stops.
      for (let step = 0; step < 220; step += 1) {
        const found = matches()

        if (found !== null && found === document.activeElement) return found

        await user.tab({ shift })
      }
    }

    throw new Error('Tab 으로 도달하지 못했습니다.')
  }

  it('reaches the filter, a row checkbox and the bulk action', async () => {
    const user = userEvent.setup()
    const table = await openList()
    const [first] = within(table).getAllByRole('row').slice(1)

    if (first === undefined) throw new Error('행이 없습니다.')

    document.body.focus()

    await tabUntil(user, () => screen.getByRole('combobox', { name: list.filters.statusLabel }))
    await tabUntil(user, () => within(first).getByRole('checkbox'))

    // Selecting from the keyboard opens the bulk bar, which must then also be
    // reachable.
    await user.keyboard(' ')

    const action = await screen.findByRole('button', { name: list.bulk.deactivate })

    await tabUntil(user, () => action)
  })

  it('reaches the adjustment input and its apply button', async () => {
    const user = userEvent.setup()
    const table = await openStock()
    const label = sellerVariants(3)[0]?.optionLabel ?? ''
    const row = within(table).getByText(label).closest('tr')

    if (row === null) throw new Error('행이 없습니다.')

    document.body.focus()

    await tabUntil(user, () => within(row).getByLabelText(`${label} ${stock.adjust.deltaLabel}`))
    await tabUntil(user, () => within(row).getByRole('button', { name: stock.adjust.apply }))
  })
})
