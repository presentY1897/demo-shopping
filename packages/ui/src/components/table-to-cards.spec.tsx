/**
 * The card form of a table.
 *
 * What is asserted is that the *same column definitions* produce the same
 * information in both views: the mobile seller order list showing three fields
 * where the desktop table shows five is the failure this component prevents by
 * construction, and the test is what keeps it that way.
 */

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { Button } from './button'
import { TableToCards } from './table-to-cards'
import type { TableColumn } from './table'

interface Order {
  readonly id: string
  readonly buyer: string
  readonly status: string
}

const ORDERS: readonly Order[] = [
  { buyer: 'Han', id: '20260903-0002', status: 'Preparing' },
  { buyer: 'Lee', id: '20260903-0001', status: 'Shipped' },
]

const COLUMNS: readonly TableColumn<Order>[] = [
  { cell: (order) => order.id, header: 'Order', key: 'id' },
  { cell: (order) => order.buyer, header: 'Buyer', key: 'buyer' },
  { cell: (order) => order.status, header: 'Status', key: 'status' },
]

describe('TableToCards', () => {
  it('renders one list item per row, named by the caption', () => {
    render(
      <TableToCards
        caption="Orders"
        columns={COLUMNS}
        rowKey={(order) => order.id}
        rows={ORDERS}
      />,
    )

    const list = screen.getByRole('list', { name: 'Orders' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  })

  it('shows every column the table would show', () => {
    render(
      <TableToCards
        caption="Orders"
        columns={COLUMNS}
        rowKey={(order) => order.id}
        rows={ORDERS}
      />,
    )

    const [first] = screen.getAllByRole('listitem')
    expect(first).toBeDefined()

    for (const value of ['20260903-0002', 'Han', 'Preparing']) {
      expect(within(first!).getByText(value)).toBeVisible()
    }
    for (const label of ['Buyer', 'Status']) {
      expect(within(first!).getByText(label)).toBeVisible()
    }
  })

  it('promotes a chosen column to the headline', () => {
    render(
      <TableToCards
        caption="Orders"
        columns={COLUMNS}
        rowKey={(order) => order.id}
        rows={ORDERS}
        titleKey="buyer"
      />,
    )

    const [first] = screen.getAllByRole('listitem')
    // The headline column drops out of the label/value pairs; the id joins them.
    expect(within(first!).getByText('Order')).toBeVisible()
    expect(within(first!).queryByText('Buyer')).not.toBeInTheDocument()
  })

  it('runs a per-row action', async () => {
    const user = setupUser()
    const onShip = vi.fn()

    render(
      <TableToCards
        actions={(order) => (
          <Button
            onClick={() => {
              onShip(order.id)
            }}
          >
            Ship
          </Button>
        )}
        caption="Orders"
        columns={COLUMNS}
        rowKey={(order) => order.id}
        rows={ORDERS}
      />,
    )

    const buttons = screen.getAllByRole('button', { name: 'Ship' })
    expect(buttons).toHaveLength(2)

    await user.click(buttons[1]!)

    expect(onShip).toHaveBeenCalledWith('20260903-0001')
  })

  it('renders an empty list rather than throwing when there are no rows', () => {
    render(
      <TableToCards caption="Orders" columns={COLUMNS} rowKey={(order) => order.id} rows={[]} />,
    )

    expect(screen.queryAllByRole('listitem')).toEqual([])
  })
})
