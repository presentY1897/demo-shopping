/**
 * `Table` — sorting, a stuck header, and the sideways scroll with a pinned first
 * column that decides whether a console is usable on a phone.
 *
 * Resize the canvas narrow (or open the story at 360px) to see the last one: the
 * table scrolls inside its own box, the order number stays put, and the page
 * itself does not grow a horizontal scrollbar.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  Badge,
  DataList,
  EmptyState,
  ErrorState,
  Skeleton,
  Table,
  type TableColumn,
  type TableProps,
} from '../../src/components'
import { formatDate, formatMoney } from '../../src/format'
import { Specimen, Stack } from '../support/layout'

interface Order {
  readonly id: string
  readonly placedAt: string
  readonly buyer: string
  readonly status: 'preparing' | 'shipped' | 'delivered'
  readonly items: number
  readonly total: number
  readonly courier: string
  readonly tracking: string
}

const ORDERS: readonly Order[] = [
  {
    buyer: '한지민',
    courier: 'Fastway',
    id: '20260903-0003',
    items: 1,
    placedAt: '2026-09-03T01:12:00.000Z',
    status: 'preparing',
    total: 32000,
    tracking: '4410-2231-9087',
  },
  {
    buyer: '이도현',
    courier: 'Fastway',
    id: '20260903-0002',
    items: 3,
    placedAt: '2026-09-02T22:41:00.000Z',
    status: 'shipped',
    total: 128000,
    tracking: '4410-2231-9012',
  },
  {
    buyer: '박서준',
    courier: 'Nordline',
    id: '20260903-0001',
    items: 2,
    placedAt: '2026-09-02T11:05:00.000Z',
    status: 'delivered',
    total: 54000,
    tracking: '9920-7781-0043',
  },
]

const STATUS_VARIANT = {
  preparing: 'warning',
  shipped: 'primary',
  delivered: 'success',
} as const

/**
 * The same array drives `Table` and `TableToCards`, which is what keeps the
 * desktop and mobile views showing the same fields. Money and dates go through
 * the formatters — no "원" anywhere in this package.
 */
const COLUMNS: readonly TableColumn<Order>[] = [
  {
    cell: (order) => order.id,
    compare: (a, b) => a.id.localeCompare(b.id),
    header: 'Order',
    key: 'id',
    sortable: true,
  },
  {
    cell: (order) => formatDate(order.placedAt, { locale: 'ko-KR', timeZone: 'Asia/Seoul' }),
    compare: (a, b) => a.placedAt.localeCompare(b.placedAt),
    header: 'Placed',
    key: 'placedAt',
    sortable: true,
  },
  { cell: (order) => order.buyer, header: 'Buyer', key: 'buyer' },
  {
    cell: (order) => <Badge variant={STATUS_VARIANT[order.status]}>{order.status}</Badge>,
    header: 'Status',
    key: 'status',
  },
  { align: 'end', cell: (order) => order.items, header: 'Items', key: 'items', numeric: true },
  {
    align: 'end',
    cell: (order) => formatMoney({ amount: order.total, currency: 'KRW' }, { locale: 'ko-KR' }),
    compare: (a, b) => a.total - b.total,
    header: 'Total',
    key: 'total',
    numeric: true,
    sortable: true,
  },
  { cell: (order) => order.courier, header: 'Courier', key: 'courier' },
  { cell: (order) => order.tracking, header: 'Tracking', key: 'tracking' },
]

/**
 * Storybook's `Meta<typeof X>` cannot carry a type argument through a generic
 * component, so the story is written against one concrete instantiation. It is
 * the same component — the wrapper only fixes `Row`.
 */
function OrderTable(props: TableProps<Order>) {
  return <Table<Order> {...props} />
}

const meta = {
  title: 'Components/Table',
  component: OrderTable,
  tags: ['autodocs'],
  args: {
    caption: 'Orders',
    columns: COLUMNS,
    rowKey: (order: Order) => order.id,
    rows: ORDERS,
  },
} satisfies Meta<typeof OrderTable>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/**
 * The sortable headers are buttons, so Tab reaches them and Enter activates
 * them. `aria-sort` on the header cell is what a screen reader reads instead of
 * the arrow — it is the part that silently goes missing.
 */
export const Sortable: Story = {
  args: { defaultSort: { direction: 'ascending', key: 'total' } },
}

/**
 * The header sticks only inside a box that scrolls vertically, so the height cap
 * belongs to the caller. Without one, sticky positioning has nothing to resolve
 * against and the option quietly does nothing.
 */
export const StickyHeader: Story = {
  args: {
    className: 'max-h-64',
    rows: [...ORDERS, ...ORDERS.map((order) => ({ ...order, id: `${order.id}-b` }))],
    stickyHeader: true,
  },
}

/**
 * The console-on-a-phone case. Eight columns at 360px cannot fit, and the answer
 * is not to hide columns — it is to let the table scroll inside its own box with
 * the order number pinned, so the reader never loses which row they are on.
 */
export const NarrowViewport: Story = {
  render: (args) => (
    <Stack>
      <Specimen label="360px — scrolls sideways, first column pinned">
        <div className="w-90 overflow-hidden">
          <OrderTable {...args} />
        </div>
      </Specimen>
    </Stack>
  ),
}

/** Pinning off, for a table narrow enough that the row header never leaves. */
export const Unpinned: Story = {
  render: (args) => (
    <div className="w-90 overflow-hidden">
      <Table<Order> {...args} columns={COLUMNS.slice(0, 3)} pinFirstColumn={false} />
    </div>
  ),
}

/**
 * The four states around a table — the same set `DataList` enforces, drawn with
 * a table's own placeholder rather than a card grid's.
 */
export const FourStates: Story = {
  render: (args) => (
    <Stack>
      {(['loading', 'empty', 'error', 'ready'] as const).map((state) => (
        <Specimen key={state} label={state}>
          <DataList
            empty={<EmptyState description="No order matches this filter." title="No orders" />}
            error={
              <ErrorState
                onRetry={() => undefined}
                retryLabel="Try again"
                title="Could not load orders"
              />
            }
            loading={<Skeleton label="Loading orders" lines={4} />}
            state={state}
          >
            <OrderTable {...args} />
          </DataList>
        </Specimen>
      ))}
    </Stack>
  ),
}

/** No rows at all: the header stays so the reader can still see what was searched. */
export const EdgeCases: Story = {
  render: (args) => (
    <Stack>
      <Specimen label="no rows">
        <OrderTable {...args} caption="Orders — none" rows={[]} />
      </Specimen>
      <Specimen label="one column">
        <OrderTable {...args} caption="Order numbers" columns={COLUMNS.slice(0, 1)} />
      </Specimen>
      <Specimen label="hidden caption">
        <OrderTable {...args} captionHidden />
      </Specimen>
    </Stack>
  ),
}
