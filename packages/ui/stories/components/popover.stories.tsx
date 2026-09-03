/**
 * `Popover` — a panel anchored to a trigger, with focus inside it.
 *
 * Unlike a tooltip, a popover can hold controls: focus moves into the panel, the
 * page behind stays interactive, and Escape returns focus to the trigger.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button, Popover, POPOVER_ALIGNMENTS, POPOVER_SIDES } from '../../src/components'
import { Row } from '../support/layout'

const meta = {
  title: 'Components/Popover',
  component: Popover,
  tags: ['autodocs'],
  args: {
    align: 'center',
    closeLabel: 'Close',
    side: 'bottom',
    title: 'Delivery estimate',
    trigger: <Button variant="ghost">When does it arrive?</Button>,
    children: <p className="text-fg-muted">Between Tuesday and Thursday for Seoul addresses.</p>,
  },
  argTypes: {
    side: { control: 'inline-radio', options: [...POPOVER_SIDES] },
    align: { control: 'inline-radio', options: [...POPOVER_ALIGNMENTS] },
  },
} satisfies Meta<typeof Popover>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Open: Story = {
  args: { defaultOpen: true },
}

export const Sides: Story = {
  render: (args) => (
    <div className="p-16">
      <Row>
        {POPOVER_SIDES.map((side) => (
          <Popover
            {...args}
            key={side}
            side={side}
            trigger={<Button variant="outline">{side}</Button>}
          />
        ))}
      </Row>
    </div>
  ),
}

export const Alignments: Story = {
  render: (args) => (
    <div className="p-16">
      <Row>
        {POPOVER_ALIGNMENTS.map((align) => (
          <Popover
            {...args}
            align={align}
            key={align}
            trigger={<Button variant="outline">{align}</Button>}
          />
        ))}
      </Row>
    </div>
  ),
}

/**
 * No header at all — neither a title nor a close button.
 *
 * The panel is still a dialog, so it still needs a name: with no title to point
 * at, `aria-label` becomes required at the type level. The story sweep found
 * this the first time it ran (`aria-dialog-name`), which is what the gate is for.
 */
export const Bare: Story = {
  args: {
    'aria-label': 'Delivery estimate',
    closeLabel: undefined,
    defaultOpen: true,
    title: undefined,
  },
}
