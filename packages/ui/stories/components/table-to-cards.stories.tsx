/**
 * `TableToCards` — the seller order list on a phone.
 *
 * DECISIONS 1장 콘솔 모바일 gives three seller screens a real mobile layout
 * instead of a sideways scroll, because checking and dispatching orders from a
 * phone is something sellers actually do. This takes the **same `TableColumn[]`**
 * the table takes, so the two views cannot end up showing different fields.
 *
 * Which of the two is mounted is the screen's decision, made once with a
 * viewport hook — not two trees hidden from each other with media queries, which
 * doubles the DOM and the accessibility tree.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  Badge,
  Button,
  Table,
  TableToCards,
  type TableColumn,
  type TableToCardsProps,
} from '../../src/components'
import { formatDate, formatMoney } from '../../src/format'
import { Specimen, Stack } from '../support/layout'

interface Order {
  readonly id: string
  readonly placedAt: string
  readonly buyer: string
  readonly status: 'preparing' | 'shipped'
  readonly total: number
}

const ORDERS: readonly Order[] = [
  {
    buyer: '한지민',
    id: '20260903-0003',
    placedAt: '2026-09-03T01:12:00.000Z',
    status: 'preparing',
    total: 32000,
  },
  {
    buyer: '이도현',
    id: '20260903-0002',
    placedAt: '2026-09-02T22:41:00.000Z',
    status: 'shipped',
    total: 128000,
  },
]

const COLUMNS: readonly TableColumn<Order>[] = [
  { cell: (order) => order.id, header: 'Order', key: 'id' },
  {
    cell: (order) => formatDate(order.placedAt, { locale: 'ko-KR', timeZone: 'Asia/Seoul' }),
    header: 'Placed',
    key: 'placedAt',
  },
  { cell: (order) => order.buyer, header: 'Buyer', key: 'buyer' },
  {
    cell: (order) => (
      <Badge variant={order.status === 'shipped' ? 'primary' : 'warning'}>{order.status}</Badge>
    ),
    header: 'Status',
    key: 'status',
  },
  {
    cell: (order) => formatMoney({ amount: order.total, currency: 'KRW' }, { locale: 'ko-KR' }),
    header: 'Total',
    key: 'total',
    numeric: true,
  },
]

/** One concrete instantiation, so the story args keep their type. */
function OrderCards(props: TableToCardsProps<Order>) {
  return <TableToCards<Order> {...props} />
}

const meta = {
  title: 'Components/TableToCards',
  component: OrderCards,
  tags: ['autodocs'],
  args: {
    caption: 'Orders',
    columns: COLUMNS,
    rowKey: (order: Order) => order.id,
    rows: ORDERS,
  },
} satisfies Meta<typeof OrderCards>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** Dispatching from the card is the whole point of the mobile layout. */
export const WithActions: Story = {
  args: {
    actions: (order: Order) => (
      <Button size="sm" variant={order.status === 'preparing' ? 'primary' : 'outline'}>
        {order.status === 'preparing' ? 'Ship' : 'Track'}
      </Button>
    ),
  },
}

/** Any column can be the headline; the rest become the label/value pairs. */
export const TitledByBuyer: Story = {
  args: { titleKey: 'buyer' },
}

/**
 * The two views of one column set, at the width each is for. The card version
 * lays its pairs out on the **card's** width, so the same card stacks them in a
 * narrow column and puts two per row in a wide one.
 */
export const AgainstTheTable: Story = {
  render: (args) => (
    <Stack>
      <Specimen label="360px — cards">
        <div className="w-90 overflow-hidden">
          <OrderCards {...args} />
        </div>
      </Specimen>
      <Specimen label="wide — table">
        <Table<Order>
          caption="Orders"
          columns={COLUMNS}
          rowKey={(order) => order.id}
          rows={ORDERS}
        />
      </Specimen>
    </Stack>
  ),
}

export const EdgeCases: Story = {
  render: (args) => (
    <Stack>
      <Specimen label="no rows">
        <OrderCards {...args} caption="Orders — none" rows={[]} />
      </Specimen>
      <Specimen label="one column">
        <OrderCards {...args} columns={COLUMNS.slice(0, 1)} />
      </Specimen>
    </Stack>
  ),
}
