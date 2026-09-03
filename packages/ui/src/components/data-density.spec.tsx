/**
 * QUALITY-GATES U4 for the data display set — every step of the density scale.
 *
 * None of these components mentions a density: `--space-unit` drives Tailwind's
 * spacing multiplier, so `px-3` and `gap-4` answer to the step on their own. The
 * value of the file is that a component which *did* branch on the step, or which
 * measured something that a nested `data-density` scope changed underneath it,
 * would fail here and nowhere else.
 *
 * jsdom applies no stylesheet, so nothing here claims anything about pixels. The
 * geometry is asserted against the real stylesheet in `test/density-tokens.spec.ts`
 * and `test/touch-target.spec.ts`.
 */

import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderAtDensity, resetDensity, setupUser } from '../../test/support/ui'
import { DENSITY_LEVELS } from '../density/density'
import { Card } from './card'
import { DataList } from './data-list'
import { EmptyState } from './empty-state'
import { ErrorState } from './error-state'
import { Grid } from './grid'
import { Pagination } from './pagination'
import { Skeleton } from './skeleton'
import { Table, type TableColumn } from './table'
import { TableToCards } from './table-to-cards'

afterEach(() => {
  resetDensity()
})

interface Order {
  readonly id: string
  readonly total: number
}

const ORDERS: readonly Order[] = [
  { id: '20260903-0002', total: 32000 },
  { id: '20260903-0001', total: 12000 },
]

const COLUMNS: readonly TableColumn<Order>[] = [
  {
    cell: (order) => order.id,
    compare: (a, b) => a.id.localeCompare(b.id),
    header: 'Order',
    key: 'id',
    sortable: true,
  },
  { align: 'end', cell: (order) => String(order.total), header: 'Total', key: 'total' },
]

describe.each(DENSITY_LEVELS)('at density %i', (density) => {
  it('a table still sorts from the keyboard', async () => {
    const user = setupUser()
    renderAtDensity(
      density,
      <Table caption="Orders" columns={COLUMNS} rowKey={(order) => order.id} rows={ORDERS} />,
    )

    await user.click(screen.getByRole('button', { name: /Order/ }))

    expect(screen.getByRole('columnheader', { name: /Order/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    expect(screen.getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      '20260903-0001',
      '20260903-0002',
    ])
  })

  it('the card form of the same table still lists every row', () => {
    renderAtDensity(
      density,
      <TableToCards
        caption="Orders"
        columns={COLUMNS}
        rowKey={(order) => order.id}
        rows={ORDERS}
      />,
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('pagination still moves', async () => {
    const user = setupUser()
    const onNext = vi.fn()
    renderAtDensity(
      density,
      <Pagination
        hasNext
        hasPrevious={false}
        label="Pages"
        nextLabel="Next"
        onNext={onNext}
        onPrevious={vi.fn()}
        previousLabel="Previous"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('the four list states still render one at a time', () => {
    const { rerender } = renderAtDensity(
      density,
      <DataList
        empty={<EmptyState title="No orders" />}
        error={<ErrorState title="Failed" />}
        loading={<Skeleton label="Loading" lines={3} />}
        state="loading"
      >
        <p>Order 20260903-0001</p>
      </DataList>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Loading')

    rerender(
      <DataList
        empty={<EmptyState title="No orders" />}
        error={<ErrorState title="Failed" />}
        loading={<Skeleton label="Loading" lines={3} />}
        state="empty"
      >
        <p>Order 20260903-0001</p>
      </DataList>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('No orders')
    expect(screen.queryByText('Order 20260903-0001')).not.toBeInTheDocument()
  })

  it('a grid of cards is still a list of the right length', () => {
    renderAtDensity(
      density,
      <Grid as="ul">
        {ORDERS.map((order) => (
          <Card as="li" key={order.id}>
            {order.id}
          </Card>
        ))}
      </Grid>,
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
