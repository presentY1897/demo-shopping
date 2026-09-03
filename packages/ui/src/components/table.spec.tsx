/**
 * The table, driven from the keyboard.
 *
 * Sorting is checked through `aria-sort` and through the order the rows actually
 * come out in — not through a class name. `aria-sort` is the part a screen
 * reader user has instead of the arrow glyph, and it is the part that silently
 * goes missing.
 *
 * The geometry (the sideways scroll, the pinned column) is asserted in
 * `test/table-layout.spec.tsx`, which compiles the real stylesheet: jsdom
 * performs no layout, so nothing here could observe it.
 */

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { nextSort, sortRows, Table, type TableColumn } from './table'

interface Order {
  readonly id: string
  readonly buyer: string
  readonly total: number
}

const ORDERS: readonly Order[] = [
  { buyer: 'Han', id: '20260903-0002', total: 32000 },
  { buyer: 'Lee', id: '20260903-0001', total: 12000 },
  { buyer: 'Park', id: '20260903-0003', total: 5000 },
]

const COLUMNS: readonly TableColumn<Order>[] = [
  {
    cell: (order) => order.id,
    compare: (a, b) => a.id.localeCompare(b.id),
    header: 'Order',
    key: 'id',
    sortable: true,
  },
  { cell: (order) => order.buyer, header: 'Buyer', key: 'buyer' },
  {
    align: 'end',
    cell: (order) => String(order.total),
    compare: (a, b) => a.total - b.total,
    header: 'Total',
    key: 'total',
    numeric: true,
    sortable: true,
  },
]

function renderTable(props: Partial<React.ComponentProps<typeof Table<Order>>> = {}) {
  return render(
    <Table<Order>
      caption="Orders"
      columns={COLUMNS}
      rowKey={(order) => order.id}
      rows={ORDERS}
      {...props}
    />,
  )
}

/** The row-header cell of every body row, in render order. */
function renderedOrder(): readonly string[] {
  return screen.getAllByRole('rowheader').map((cell) => cell.textContent ?? '')
}

describe('nextSort', () => {
  it('starts a new column ascending', () => {
    expect(nextSort(null, 'total')).toEqual({ direction: 'ascending', key: 'total' })
    expect(nextSort({ direction: 'descending', key: 'id' }, 'total')).toEqual({
      direction: 'ascending',
      key: 'total',
    })
  })

  it('flips the active column', () => {
    expect(nextSort({ direction: 'ascending', key: 'id' }, 'id')).toEqual({
      direction: 'descending',
      key: 'id',
    })
    expect(nextSort({ direction: 'descending', key: 'id' }, 'id')).toEqual({
      direction: 'ascending',
      key: 'id',
    })
  })
})

describe('sortRows', () => {
  it('returns the rows untouched when there is no sort', () => {
    expect(sortRows(ORDERS, COLUMNS, null)).toBe(ORDERS)
  })

  it('returns the rows untouched when the column cannot compare', () => {
    // The server-sorted case: the table reports the click and nothing else.
    expect(sortRows(ORDERS, COLUMNS, { direction: 'ascending', key: 'buyer' })).toBe(ORDERS)
  })

  it('does not mutate the array it was given', () => {
    const sorted = sortRows(ORDERS, COLUMNS, { direction: 'ascending', key: 'total' })

    expect(sorted).not.toBe(ORDERS)
    expect(ORDERS[0]?.id).toBe('20260903-0002')
  })
})

describe('Table', () => {
  it('marks the identifying column as the row header', () => {
    renderTable()

    expect(renderedOrder()).toEqual(['20260903-0002', '20260903-0001', '20260903-0003'])
    // Two data cells per row; the third is the row header.
    expect(screen.getAllByRole('cell')).toHaveLength(ORDERS.length * 2)
  })

  it('reports no sort until one is chosen', () => {
    renderTable()

    expect(screen.getByRole('columnheader', { name: /Order/ })).toHaveAttribute('aria-sort', 'none')
    // A column that cannot be sorted must not claim it can.
    expect(screen.getByRole('columnheader', { name: 'Buyer' })).not.toHaveAttribute('aria-sort')
  })

  it('sorts from the keyboard and reports the direction', async () => {
    const user = setupUser()
    renderTable()

    // The scroll region is the first tab stop; the sort buttons follow it.
    await user.tab()
    await user.tab()
    expect(screen.getByRole('button', { name: /Order/ })).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(screen.getByRole('columnheader', { name: /Order/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    expect(renderedOrder()).toEqual(['20260903-0001', '20260903-0002', '20260903-0003'])
  })

  it('flips the direction on a second activation', async () => {
    const user = setupUser()
    renderTable()

    const header = screen.getByRole('button', { name: /Total/ })
    await user.click(header)
    expect(renderedOrder()).toEqual(['20260903-0003', '20260903-0001', '20260903-0002'])

    await user.click(header)

    expect(screen.getByRole('columnheader', { name: /Total/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
    expect(renderedOrder()).toEqual(['20260903-0002', '20260903-0001', '20260903-0003'])
  })

  it('moves the sort indicator to the column that was clicked', async () => {
    const user = setupUser()
    renderTable()

    await user.click(screen.getByRole('button', { name: /Order/ }))
    await user.click(screen.getByRole('button', { name: /Total/ }))

    expect(screen.getByRole('columnheader', { name: /Order/ })).toHaveAttribute('aria-sort', 'none')
    expect(screen.getByRole('columnheader', { name: /Total/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
  })

  it('leaves the order alone when the caller controls the sort', async () => {
    const user = setupUser()
    const onSortChange = vi.fn()

    renderTable({ onSortChange, sort: { direction: 'descending', key: 'total' } })

    await user.click(screen.getByRole('button', { name: /Order/ }))

    // The server owns the ordering: the click is reported, the rows are not
    // reshuffled behind the caller's back.
    expect(onSortChange).toHaveBeenCalledWith({ direction: 'ascending', key: 'id' })
    expect(screen.getByRole('columnheader', { name: /Total/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
  })

  it('names its scroll region with the caption and puts it in the tab order', async () => {
    const user = setupUser()
    renderTable()

    const region = screen.getByRole('region', { name: 'Orders' })
    expect(within(region).getByRole('table', { name: 'Orders' })).toBeInTheDocument()

    // WCAG 2.1.1: a region that only pans by dragging is unreachable without a
    // pointer, so it has to be focusable.
    await user.tab()
    expect(region).toHaveFocus()
  })

  it('keeps the caption available to a screen reader when it is hidden', () => {
    renderTable({ captionHidden: true })

    expect(screen.getByRole('table', { name: 'Orders' })).toBeInTheDocument()
  })

  it('renders a header row and nothing else when there are no rows', () => {
    renderTable({ rows: [] })

    expect(screen.getAllByRole('row')).toHaveLength(1)
    expect(screen.queryAllByRole('rowheader')).toEqual([])
  })
})
