/**
 * `/products` — 상품 목록 (TASK-0116 6.1).
 *
 * The API is `@shopping/api-mocks` and the mock keeps state, so these assert
 * what the screen *did*: a bulk change really moves five rows, paging really
 * walks a hundred without repeating one, a duplicate really lands in the store.
 * A frozen payload could not fail any of those.
 */

import {
  httpFailureOn,
  mockPaths,
  sellerConsoleSnapshot,
  sellerProductId,
  SELLER_PRODUCT_COUNT,
} from '@shopping/api-mocks'
import { LOW_STOCK_THRESHOLD } from '@shopping/shared'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import ProductsPage from '@/app/products/page'
import { messagesFor } from '@/messages'

import { testServer } from './setup'

const copy = messagesFor().productList

/** Renders `/products` and waits for the table to have arrived. */
async function openList(): Promise<HTMLElement> {
  render(<ProductsPage />)

  return screen.findByRole('table', { name: copy.table.caption })
}

/**
 * Picks an option out of one of the filter's dropdowns.
 *
 * `Select` is Radix, not a native `<select>`, so `selectOptions` has nothing to
 * work with: the control is a `combobox` button and the choices only exist once
 * it is open.
 */
async function choose(user: UserEvent, comboboxName: string, option: string): Promise<void> {
  await user.click(screen.getByRole('combobox', { name: comboboxName }))
  await user.click(await screen.findByRole('option', { name: option }))
}

/** The data rows, without the header. */
function rows(table: HTMLElement): readonly HTMLElement[] {
  const [, ...body] = within(table).getAllByRole('row')

  return body
}

describe('U1 · P5 — the four states', () => {
  it('announces the wait before the API has answered', () => {
    render(<ProductsPage />)

    // The live region's *content* is the announcement — `status` is not a
    // name-from-content role, so there is nothing to match by name.
    expect(screen.getByRole('status')).toHaveTextContent(copy.loadingLabel)
  })

  it('shows the rows once they arrive (F1)', async () => {
    const table = await openList()

    // The default page is 20, and every row carries what the console manages.
    expect(rows(table)).toHaveLength(20)
    expect(within(table).getByText('데일리 코튼 티셔츠 001')).toBeVisible()
  })

  it('offers a retry rather than an empty table when the load fails', async () => {
    testServer.server.use(
      httpFailureOn('get', mockPaths.sellerProducts, 500, 'INTERNAL_ERROR', '서버 오류'),
    )
    render(<ProductsPage />)

    expect(await screen.findByText(copy.errorTitle)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.retry })).toBeVisible()
  })

  it('tells an empty result from an empty store', async () => {
    render(<ProductsPage />)
    await screen.findByRole('table', { name: copy.table.caption })

    const user = userEvent.setup()

    await user.type(screen.getByLabelText(copy.filters.searchLabel), '없는상품명{Enter}')

    expect(await screen.findByText(copy.filteredEmpty.title)).toBeVisible()
  })
})

describe('badges (F10)', () => {
  it('marks the threshold and leaves one above it alone', async () => {
    // The rule is `0 < totalStock <= LOW_STOCK_THRESHOLD`, and the fixture puts a
    // listing at each side of it. Nothing here names the number 5 — if the
    // constant moves, this still describes the rule.
    const table = await openList()
    const atThreshold = within(table).getByText(`데일리 코튼 티셔츠 002`).closest('tr')
    const justAbove = within(table).getByText(`데일리 코튼 티셔츠 003`).closest('tr')

    expect(atThreshold).not.toBeNull()
    expect(within(atThreshold as HTMLElement).getByText(copy.badges.low)).toBeVisible()
    expect(within(justAbove as HTMLElement).queryByText(copy.badges.low)).toBeNull()
  })

  it('marks 품절 separately from 품절 임박', async () => {
    const table = await openList()
    const soldOut = within(table).getByText('데일리 코튼 티셔츠 001').closest('tr')

    expect(within(soldOut as HTMLElement).getByText(copy.badges.out)).toBeVisible()
    expect(LOW_STOCK_THRESHOLD).toBeGreaterThan(0)
  })
})

describe('filters (F3)', () => {
  it('narrows by status', async () => {
    await openList()

    const user = userEvent.setup()

    await choose(user, copy.filters.statusLabel, messagesFor().products.statusLabels.DRAFT)

    await waitFor(() => {
      // Re-queried inside the wait: the table is replaced when the page reloads,
      // and asserting against the element captured before the filter would be
      // asserting about markup that is no longer on screen.
      const table = screen.getByRole('table', { name: copy.table.caption })
      const draft = within(table).getAllByText(messagesFor().products.statusLabels.DRAFT)

      expect(draft).toHaveLength(rows(table).length)
    })
  })

  it('narrows to 품절 임박, which is the server’s definition and not a number here', async () => {
    await openList()

    const user = userEvent.setup()

    await choose(user, copy.filters.stockLabel, copy.filters.stockOptions.low)

    await waitFor(() => {
      const table = screen.getByRole('table', { name: copy.table.caption })

      for (const row of rows(table)) {
        expect(within(row).getByText(copy.badges.low)).toBeVisible()
      }
    })
  })

  it('clears every condition at once, and the search box with them', async () => {
    await openList()

    const user = userEvent.setup()
    const search = screen.getByLabelText(copy.filters.searchLabel)

    await user.type(search, '002{Enter}')
    await waitFor(() => {
      expect(rows(screen.getByRole('table', { name: copy.table.caption }))).toHaveLength(1)
    })

    await user.click(screen.getByRole('button', { name: copy.filters.reset }))

    // The box has to empty too — otherwise the word stays on screen describing a
    // filter that is no longer applied.
    await waitFor(() => {
      expect(search).toHaveValue('')
    })
    await waitFor(() => {
      expect(rows(screen.getByRole('table', { name: copy.table.caption }))).toHaveLength(20)
    })
  })
})

describe('paging (F5)', () => {
  it('walks the catalogue with no duplicate and no gap', async () => {
    const user = userEvent.setup()

    await openList()

    const seen: string[] = []

    for (let page = 0; page < SELLER_PRODUCT_COUNT / 20; page += 1) {
      const table = screen.getByRole('table', { name: copy.table.caption })
      const names = rows(table).map((row) => within(row).getByText(/티셔츠/).textContent ?? '')

      seen.push(...names)

      const next = screen.getByRole('button', { name: copy.pagination.next })

      if (next.hasAttribute('disabled')) break

      const leaving = names[0] ?? ''

      await user.click(next)
      // The page has turned when the row that was first is gone — waiting on a
      // count would pass immediately, because both pages have twenty rows.
      await waitFor(() => {
        const turned = screen.getByRole('table', { name: copy.table.caption })

        expect(within(turned).queryByText(leaving)).toBeNull()
      })
    }

    expect(seen).toHaveLength(SELLER_PRODUCT_COUNT)
    expect(new Set(seen).size).toBe(SELLER_PRODUCT_COUNT)
  })
})

describe('bulk status (F4)', () => {
  it('changes every selected listing in one request, and says how many', async () => {
    const user = userEvent.setup()
    const table = await openList()

    for (const index of [0, 1, 2, 3, 4]) {
      const row = rows(table)[index]

      if (row === undefined) throw new Error('행이 없습니다.')

      await user.click(within(row).getByRole('checkbox'))
    }

    expect(screen.getByText(copy.bulk.selected.replace('{count}', '5'))).toBeVisible()

    await user.click(screen.getByRole('button', { name: copy.bulk.deactivate }))
    await user.click(screen.getByRole('button', { name: copy.bulk.confirm }))

    await waitFor(() => {
      expect(screen.getByText(copy.bulk.done.replace('{count}', '5'))).toBeVisible()
    })

    const changed = sellerConsoleSnapshot().filter((item) => item.status === 'INACTIVE')

    expect(changed).toHaveLength(5)
  })

  it('clears the selection when the page changes, so the count is countable (R3)', async () => {
    const user = userEvent.setup()
    const table = await openList()
    const first = rows(table)[0]

    if (first === undefined) throw new Error('행이 없습니다.')

    await user.click(within(first).getByRole('checkbox'))
    expect(screen.getByText(copy.bulk.selected.replace('{count}', '1'))).toBeVisible()

    await user.click(screen.getByRole('button', { name: copy.pagination.next }))

    await waitFor(() => {
      expect(screen.queryByText(copy.bulk.selected.replace('{count}', '1'))).toBeNull()
    })
  })
})

describe('duplication (F6)', () => {
  it('says the copy will be a draft before the click, then makes one', async () => {
    const user = userEvent.setup()
    const table = await openList()
    const row = rows(table)[0]

    if (row === undefined) throw new Error('행이 없습니다.')

    const before = sellerConsoleSnapshot().length

    await user.click(within(row).getByRole('button', { name: copy.table.duplicate }))

    // The sentence that stops a surprise publication.
    expect(screen.getByText(copy.duplicate.draftNotice)).toBeVisible()

    await user.click(screen.getByRole('button', { name: copy.duplicate.confirm }))

    await waitFor(() => {
      expect(sellerConsoleSnapshot()).toHaveLength(before + 1)
    })
    expect(sellerConsoleSnapshot().at(-1)?.status).toBe('DRAFT')
  })

  it('shows the refusal in the dialog and changes nothing (U6)', async () => {
    testServer.server.use(
      httpFailureOn('post', mockPaths.sellerProductDuplicate, 500, 'INTERNAL_ERROR', '서버 오류'),
    )

    const user = userEvent.setup()
    const table = await openList()
    const row = rows(table)[0]

    if (row === undefined) throw new Error('행이 없습니다.')

    const before = sellerConsoleSnapshot().length

    await user.click(within(row).getByRole('button', { name: copy.table.duplicate }))
    await user.click(screen.getByRole('button', { name: copy.duplicate.confirm }))

    expect(await screen.findByText(copy.failure.title)).toBeVisible()
    expect(sellerConsoleSnapshot()).toHaveLength(before)
  })
})

describe('the store is untouched between specs', () => {
  it('starts from a hundred listings every time', () => {
    expect(sellerConsoleSnapshot()).toHaveLength(SELLER_PRODUCT_COUNT)
    expect(sellerProductId(0)).toContain('1e5c0000')
  })
})
