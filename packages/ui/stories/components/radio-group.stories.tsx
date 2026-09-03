/**
 * `RadioGroup` — one tab stop, arrow keys between the options.
 *
 * That is what WAI-ARIA specifies for a radio group and what a hand-written
 * version invariably gets wrong by leaving every radio in the tab order. Radix
 * implements the roving tab index; `Radio` reads the group's context and must be
 * rendered inside it.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Radio, RadioGroup, RADIO_ORIENTATIONS } from '../../src/components'
import { Stack } from '../support/layout'

const SHIPPING = [
  { label: 'Standard · 2–3 days', value: 'standard' },
  { label: 'Express · next day', value: 'express' },
  { label: 'Pick up in store', value: 'pickup' },
]

const meta = {
  title: 'Components/RadioGroup',
  component: RadioGroup,
  tags: ['autodocs'],
  args: {
    'aria-label': 'Shipping method',
    defaultValue: 'standard',
    orientation: 'vertical',
  },
  argTypes: {
    orientation: { control: 'inline-radio', options: [...RADIO_ORIENTATIONS] },
  },
  render: (args) => (
    <RadioGroup {...args}>
      {SHIPPING.map((option) => (
        <Radio key={option.value} label={option.label} value={option.value} />
      ))}
    </RadioGroup>
  ),
} satisfies Meta<typeof RadioGroup>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Horizontal: Story = {
  args: { orientation: 'horizontal' },
}

export const WithDescriptions: Story = {
  render: (args) => (
    <RadioGroup {...args}>
      <Radio description="Free over ₩50,000." label="Standard" value="standard" />
      <Radio description="Ordered before 14:00." label="Express" value="express" />
      <Radio description="Ready in two hours." label="Pick up in store" value="pickup" />
    </RadioGroup>
  ),
}

export const States: Story = {
  render: (args) => (
    <Stack>
      <RadioGroup {...args} aria-label="Shipping method · one option disabled">
        <Radio label="Standard" value="standard" />
        <Radio disabled label="Express — unavailable to this address" value="express" />
      </RadioGroup>
      <RadioGroup {...args} aria-label="Shipping method · whole group disabled" disabled>
        <Radio label="Standard" value="standard" />
        <Radio label="Express" value="express" />
      </RadioGroup>
    </Stack>
  ),
}
