/**
 * `Tabs` — panels behind a single tab stop.
 *
 * `activationMode` is the choice worth knowing about: `automatic` shows a panel
 * as the arrow keys move, which is right when the panels are cheap;
 * `manual` waits for Enter, which is right when opening one costs a request.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Tabs, TABS_ACTIVATION_MODES, TABS_ORIENTATIONS } from '../../src/components'
import { Stack } from '../support/layout'

const ITEMS = [
  { content: <p>Cotton twill, made in Korea.</p>, label: 'Details', value: 'details' },
  { content: <p>Free over ₩50,000, two to three days.</p>, label: 'Delivery', value: 'delivery' },
  { content: <p>Within 7 days of delivery.</p>, label: 'Returns', value: 'returns' },
]

const meta = {
  title: 'Components/Tabs',
  component: Tabs,
  tags: ['autodocs'],
  args: {
    'aria-label': 'Product information',
    activationMode: 'automatic',
    items: ITEMS,
    orientation: 'horizontal',
  },
  argTypes: {
    orientation: { control: 'inline-radio', options: [...TABS_ORIENTATIONS] },
    activationMode: { control: 'inline-radio', options: [...TABS_ACTIVATION_MODES] },
  },
} satisfies Meta<typeof Tabs>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Vertical: Story = {
  args: { orientation: 'vertical' },
}

export const ManualActivation: Story = {
  args: { activationMode: 'manual' },
}

export const States: Story = {
  render: (args) => (
    <Stack>
      <Tabs
        {...args}
        items={[
          ...ITEMS,
          { content: <p>Not available.</p>, disabled: true, label: 'Reviews', value: 'reviews' },
        ]}
      />
    </Stack>
  ),
}

/** One tab, and more tabs than the row can hold. */
export const EdgeCases: Story = {
  render: (args) => (
    <Stack>
      <Tabs {...args} aria-label="One tab" items={ITEMS.slice(0, 1)} />
      <Tabs
        {...args}
        aria-label="Many tabs"
        items={Array.from({ length: 12 }, (_, index) => ({
          content: <p>{`Panel ${String(index + 1)}`}</p>,
          label: `Section ${String(index + 1)}`,
          value: `section-${String(index + 1)}`,
        }))}
      />
    </Stack>
  ),
}
