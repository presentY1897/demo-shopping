/**
 * `Tooltip` — supplementary text on hover and on focus.
 *
 * A tooltip is never the only place information lives: it does not appear for a
 * touch user at all. Nesting a provider is legal in Radix and the inner one
 * wins, so a tooltip is self-contained by default and still joins a shared timer
 * when an app wraps a screen in `TooltipProvider`.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button, Tooltip, TooltipProvider, TOOLTIP_SIDES } from '../../src/components'
import { Row } from '../support/layout'

const meta = {
  title: 'Components/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
  args: {
    content: 'Settled every Monday',
    side: 'top',
    children: <Button variant="ghost">Payout schedule</Button>,
  },
  argTypes: {
    side: { control: 'inline-radio', options: [...TOOLTIP_SIDES] },
  },
} satisfies Meta<typeof Tooltip>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** Open on load, so the panel is what the accessibility checker sees. */
export const Open: Story = {
  args: { defaultOpen: true },
}

export const Sides: Story = {
  render: (args) => (
    <div className="p-16">
      <Row>
        {TOOLTIP_SIDES.map((side) => (
          <Tooltip {...args} key={side} side={side}>
            <Button variant="outline">{side}</Button>
          </Tooltip>
        ))}
      </Row>
    </div>
  ),
}

/** A shared provider: moving between triggers skips the delay. */
export const SharedTimer: Story = {
  render: (args) => (
    <TooltipProvider delayDuration={300}>
      <Row>
        <Tooltip {...args} content="Paid on delivery">
          <Button variant="outline">First</Button>
        </Tooltip>
        <Tooltip {...args} content="Settled every Monday">
          <Button variant="outline">Second</Button>
        </Tooltip>
      </Row>
    </TooltipProvider>
  ),
}

/** Content longer than the trigger, which `max-w-96` has to contain. */
export const EdgeCases: Story = {
  args: {
    defaultOpen: true,
    content:
      'Settlements run every Monday for orders delivered and unclaimed for seven days, minus the platform fee.',
  },
}
