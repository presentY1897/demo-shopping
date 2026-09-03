/**
 * `Divider` — a rule, optionally with a label in the middle.
 *
 * Written directly rather than on `@radix-ui/react-separator`: taking the
 * dependency would make every divider a client component, so a static footer
 * rule would pull React into a bundle to draw a line.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Divider, DIVIDER_ORIENTATIONS } from '../../src/components'
import { Stack } from '../support/layout'

const meta = {
  title: 'Components/Divider',
  component: Divider,
  tags: ['autodocs'],
  args: { orientation: 'horizontal' },
  argTypes: {
    orientation: { control: 'inline-radio', options: [...DIVIDER_ORIENTATIONS] },
  },
} satisfies Meta<typeof Divider>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <div className="max-w-96">
      <Divider {...args} />
    </div>
  ),
}

export const WithLabel: Story = {
  render: (args) => (
    <div className="max-w-96">
      <Divider {...args} label="or" />
    </div>
  ),
}

export const Vertical: Story = {
  render: () => (
    <div className="flex h-10 items-center gap-3">
      <span className="text-fg-muted text-sm">Seller</span>
      <Divider orientation="vertical" />
      <span className="text-fg-muted text-sm">Shipped from Seoul</span>
    </div>
  ),
}

/**
 * A decorative rule is hidden from assistive technology, which is right for a
 * line that only repeats what the heading structure already says — and wrong for
 * one that is the only signal a group has ended.
 */
export const Decorative: Story = {
  render: (args) => (
    <Stack>
      <div className="max-w-96">
        <Divider {...args} />
        <p className="text-fg-subtle pt-2 text-xs">role=&quot;separator&quot;</p>
      </div>
      <div className="max-w-96">
        <Divider {...args} decorative />
        <p className="text-fg-subtle pt-2 text-xs">role=&quot;none&quot;</p>
      </div>
    </Stack>
  ),
}
