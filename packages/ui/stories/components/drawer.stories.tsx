/**
 * `Drawer` — the same dialog behaviour, anchored to an edge.
 *
 * Shares Radix's dialog with `Modal`, so the focus trap, the scroll lock and the
 * labelling are identical; only the position differs.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button, Drawer, DRAWER_SIDES, ModalClose } from '../../src/components'
import { Row } from '../support/layout'

const meta = {
  title: 'Components/Drawer',
  component: Drawer,
  tags: ['autodocs'],
  args: {
    closeLabel: 'Close',
    description: '3 items · ₩128,000',
    side: 'right',
    title: 'Cart',
    trigger: <Button variant="outline">Open</Button>,
    children: <p>Items are grouped by seller, because each one ships separately.</p>,
    footer: (
      <ModalClose>
        <Button>Checkout</Button>
      </ModalClose>
    ),
  },
  argTypes: {
    side: { control: 'inline-radio', options: [...DRAWER_SIDES] },
  },
} satisfies Meta<typeof Drawer>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Open: Story = {
  args: { defaultOpen: true },
}

export const Sides: Story = {
  render: (args) => (
    <Row>
      {DRAWER_SIDES.map((side) => (
        <Drawer
          {...args}
          key={side}
          side={side}
          title={`Cart · ${side}`}
          trigger={<Button variant="outline">{side}</Button>}
        />
      ))}
    </Row>
  ),
}

/** A body longer than the panel, which is what the edge sheets are usually for. */
export const EdgeCases: Story = {
  args: {
    defaultOpen: true,
    description: undefined,
    children: (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 30 }, (_, index) => (
          <p key={index}>{`Item ${String(index + 1)}`}</p>
        ))}
      </div>
    ),
  },
}
