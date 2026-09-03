/**
 * `Switch` — a toggle that takes effect immediately.
 *
 * Not a checkbox: it commits the moment it moves, so it belongs to settings
 * rather than to a form that is submitted. The track is 44px wide, which clears
 * the touch floor horizontally on its own; `touch-target` covers the vertical
 * axis.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Switch } from '../../src/components'
import { Stack } from '../support/layout'

const meta = {
  title: 'Components/Switch',
  component: Switch,
  tags: ['autodocs'],
  args: { label: 'Order notifications' },
} satisfies Meta<typeof Switch>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const States: Story = {
  render: (args) => (
    <Stack>
      <Switch {...args} label="Off" />
      <Switch {...args} defaultChecked label="On" />
      <Switch {...args} disabled label="Disabled" />
      <Switch {...args} defaultChecked disabled label="Disabled and on" />
      <Switch
        {...args}
        description="Sent whenever a seller updates a shipment."
        label="With a description"
      />
    </Stack>
  ),
}

/** No visible label: the accessible name still has to exist. */
export const LabelledExternally: Story = {
  args: { 'aria-label': 'Order notifications', label: undefined },
}
