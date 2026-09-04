/**
 * `/products/[id]/stock` — Variant 별 재고 (TASK-0116 6.1).
 *
 * The screen's one design decision is an **absence**: there is no control that
 * sets a stock level (F2b). Most of what follows is about the consequences of
 * that — the delta is validated here, the "would go below zero" refusal is
 * validated by the server and shown on the field, and the history is what makes
 * a delta-only screen answerable when somebody asks why the number is 17.
 */

import {
  failNextStockAdjustment,
  sellerProductId,
  sellerVariantId,
  sellerVariants,
} from '@shopping/api-mocks'
import { STOCK_MAX_MOVEMENT } from '@shopping/shared'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import StockPage from '@/app/products/[id]/stock/page'
import { messagesFor } from '@/messages'

const copy = messagesFor().productStock

/** The listing whose first combination starts sold out — the F9 fixture. */
const SOLD_OUT = sellerProductId(0)
/** A listing with stock to move. */
const STOCKED = sellerProductId(3)

async function openStock(productId: string): Promise<HTMLElement> {
  render(await StockPage({ params: Promise.resolve({ id: productId }) }))

  return screen.findByRole('table', { name: copy.caption })
}

function rowFor(table: HTMLElement, optionLabel: string): HTMLElement {
  const cell = within(table).getByText(optionLabel)
  const row = cell.closest('tr')

  if (row === null) throw new Error(`행을 찾지 못했습니다: ${optionLabel}`)

  return row
}

/** Types a delta into one row and presses 적용. */
async function adjust(
  user: UserEvent,
  row: HTMLElement,
  optionLabel: string,
  delta: string,
): Promise<void> {
  await user.clear(within(row).getByLabelText(`${optionLabel} ${copy.adjust.deltaLabel}`))
  if (delta !== '') {
    await user.type(within(row).getByLabelText(`${optionLabel} ${copy.adjust.deltaLabel}`), delta)
  }
  await user.click(within(row).getByRole('button', { name: copy.adjust.apply }))
}

describe('F2b — there is no way to set a stock level', () => {
  it('offers no field that takes an absolute number', async () => {
    const table = await openStock(STOCKED)
    const boxes = within(table).getAllByRole('textbox')

    // Every input on this screen is a delta or a reason. A box labelled with the
    // stock column's own header would be the one that corrupts a concurrent sale.
    for (const box of boxes) {
      const label = box.getAttribute('aria-label') ?? box.id
      const text = within(table).getByText(copy.stock, { selector: 'th, th *' })

      expect(text).toBeVisible()
      expect(label).not.toBe(copy.stock)
    }
    expect(boxes.length).toBeGreaterThan(0)
  })
})

describe('F2 · R1 — adjusting', () => {
  it('shows the number the seller was thinking of before the click', async () => {
    const user = userEvent.setup()
    const table = await openStock(STOCKED)
    const label = sellerVariants(3)[0]?.optionLabel ?? ''
    const row = rowFor(table, label)
    const before = sellerVariants(3)[0]?.stock ?? 0

    await user.type(within(row).getByLabelText(`${label} ${copy.adjust.deltaLabel}`), '+5')

    expect(
      within(row).getByText(
        copy.adjust.preview
          .replace('{from}', before.toLocaleString('ko-KR'))
          .replace('{to}', (before + 5).toLocaleString('ko-KR')),
      ),
    ).toBeVisible()
  })

  it('applies the delta and shows the balance the server answered with', async () => {
    const user = userEvent.setup()
    const table = await openStock(STOCKED)
    const label = sellerVariants(3)[0]?.optionLabel ?? ''
    const before = sellerVariants(3)[0]?.stock ?? 0

    await adjust(user, rowFor(table, label), label, '+5')

    await waitFor(() => {
      expect(
        screen.getByText(copy.adjusted.replace('{stock}', (before + 5).toLocaleString('ko-KR'))),
      ).toBeVisible()
    })
    expect(within(rowFor(table, label)).getByText(String(before + 5))).toBeVisible()
  })

  it('does not send a second movement for a second click (U3)', async () => {
    // A duplicated request here is not a duplicated render — it is stock that
    // moved twice.
    const user = userEvent.setup()
    const table = await openStock(STOCKED)
    const label = sellerVariants(3)[0]?.optionLabel ?? ''
    const row = rowFor(table, label)
    const before = sellerVariants(3)[0]?.stock ?? 0
    const apply = within(row).getByRole('button', { name: copy.adjust.apply })

    await user.type(within(row).getByLabelText(`${label} ${copy.adjust.deltaLabel}`), '+5')

    // Both clicks inside one `act`, dispatched directly. `user.click` awaits and
    // `fireEvent` flushes a render between calls, so either of them would let
    // the first click's state land before the second — which is exactly the
    // situation the guard does *not* have to handle. A real double-click gives
    // React no chance to re-render in between, and neither does this.
    await act(async () => {
      apply.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      apply.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(within(rowFor(table, label)).getByText(String(before + 5))).toBeVisible()
    })
    expect(within(rowFor(table, label)).queryByText(String(before + 10))).toBeNull()
  })
})

describe('F8 · U2 — what the screen can refuse on its own', () => {
  it('refuses an empty box on the field, without asking the server', async () => {
    const user = userEvent.setup()
    const table = await openStock(STOCKED)
    const label = sellerVariants(3)[0]?.optionLabel ?? ''
    const row = rowFor(table, label)

    await adjust(user, row, label, '')

    expect(within(row).getByRole('alert')).toHaveTextContent(copy.adjust.deltaRequired)
  })

  it('refuses zero, which is not an adjustment', async () => {
    const user = userEvent.setup()
    const table = await openStock(STOCKED)
    const label = sellerVariants(3)[0]?.optionLabel ?? ''
    const row = rowFor(table, label)

    await adjust(user, row, label, '0')

    expect(within(row).getByRole('alert')).toHaveTextContent(copy.adjust.deltaZero)
  })

  it('refuses more than one movement may carry', async () => {
    const user = userEvent.setup()
    const table = await openStock(STOCKED)
    const label = sellerVariants(3)[0]?.optionLabel ?? ''
    const row = rowFor(table, label)

    await adjust(user, row, label, String(STOCK_MAX_MOVEMENT + 1))

    expect(within(row).getByRole('alert')).toBeVisible()
  })
})

describe('F9 — what only the server can refuse', () => {
  it('shows the refusal on the field and leaves the number alone', async () => {
    const user = userEvent.setup()
    const table = await openStock(SOLD_OUT)
    const label = sellerVariants(0)[0]?.optionLabel ?? ''
    const row = rowFor(table, label)

    // The listing is sold out, so any decrease is a result below zero — which
    // this screen cannot know and does not try to.
    await adjust(user, row, label, '-1')

    await waitFor(() => {
      expect(within(rowFor(table, label)).getByRole('alert')).toBeVisible()
    })
    expect(within(rowFor(table, label)).getByText('0')).toBeVisible()
  })

  it('puts a failure that is not about the field in the panel instead (U6)', async () => {
    failNextStockAdjustment()

    const user = userEvent.setup()
    const table = await openStock(STOCKED)
    const label = sellerVariants(3)[0]?.optionLabel ?? ''
    const before = sellerVariants(3)[0]?.stock ?? 0

    await adjust(user, rowFor(table, label), label, '+5')

    expect(await screen.findByText(copy.failure.title)).toBeVisible()
    expect(within(rowFor(table, label)).getByText(String(before))).toBeVisible()
  })
})

describe('F7 — the history', () => {
  it('opens on demand and shows what produced the number', async () => {
    const user = userEvent.setup()
    const table = await openStock(STOCKED)
    const label = sellerVariants(3)[0]?.optionLabel ?? ''
    const row = rowFor(table, label)

    await user.click(
      within(row).getByRole('button', {
        name: copy.ledger.openLabel.replace('{option}', label),
      }),
    )

    const ledger = await screen.findByRole('table', { name: copy.ledger.caption })

    // Every combination is born with an opening `INBOUND`, so there is always
    // at least one row explaining the number.
    expect(within(ledger).getByText(copy.ledger.typeLabels.INBOUND)).toBeVisible()
  })

  it('gains the movement that was just made', async () => {
    const user = userEvent.setup()
    const table = await openStock(STOCKED)
    const label = sellerVariants(3)[0]?.optionLabel ?? ''

    await user.click(
      within(rowFor(table, label)).getByRole('button', {
        name: copy.ledger.openLabel.replace('{option}', label),
      }),
    )
    await screen.findByRole('table', { name: copy.ledger.caption })

    await adjust(user, rowFor(table, label), label, '+3')

    await waitFor(() => {
      const ledger = screen.getByRole('table', { name: copy.ledger.caption })

      expect(within(ledger).getByText('+3')).toBeVisible()
    })
  })
})

describe('U5 — without a mouse', () => {
  it('completes one adjustment from the keyboard alone', async () => {
    const user = userEvent.setup()
    const table = await openStock(STOCKED)
    const label = sellerVariants(3)[0]?.optionLabel ?? ''
    const before = sellerVariants(3)[0]?.stock ?? 0

    within(rowFor(table, label)).getByLabelText(`${label} ${copy.adjust.deltaLabel}`).focus()
    await user.keyboard('+2')
    // Tab past 구분 and 사유 to 적용, then press it.
    await user.tab()
    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(within(rowFor(table, label)).getByText(String(before + 2))).toBeVisible()
    })
  })
})

describe('the id comes from the route', () => {
  it('renders the empty state for a listing with no combinations', async () => {
    // `sellerVariantId` exists so a spec can name a combination; the id here is
    // a product that is not in the store at all.
    render(await StockPage({ params: Promise.resolve({ id: sellerVariantId(999) }) }))

    expect(await screen.findByText(copy.errorTitle)).toBeVisible()
  })
})
