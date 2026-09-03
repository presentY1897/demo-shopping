/**
 * `Checkbox` — including the indeterminate state.
 *
 * The drawn box is 20px and the hit area is 44px. A 44px checkbox looks broken,
 * but a 20px tap target is one, so the button around the square carries
 * `touch-target` and the label is tied with `htmlFor` to give a second, much
 * larger hit area.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { Checkbox, type CheckboxState } from '../../src/components'
import { Stack } from '../support/layout'

const meta = {
  title: 'Components/Checkbox',
  component: Checkbox,
  tags: ['autodocs'],
  args: { label: 'Agree to the terms of sale' },
} satisfies Meta<typeof Checkbox>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithDescription: Story = {
  args: {
    description: 'Required before an order can be placed.',
    label: 'Agree to the terms of sale',
  },
}

export const States: Story = {
  render: (args) => (
    <Stack>
      <Checkbox {...args} label="Unchecked" />
      <Checkbox {...args} defaultChecked label="Checked" />
      <Checkbox {...args} checked="indeterminate" label="Indeterminate" />
      <Checkbox {...args} disabled label="Disabled" />
      <Checkbox {...args} defaultChecked disabled label="Disabled and checked" />
      <Checkbox {...args} invalid label="Invalid" />
    </Stack>
  ),
}

function SelectAll() {
  const [items, setItems] = useState<readonly boolean[]>([true, false, false])
  const checkedCount = items.filter(Boolean).length
  const all: CheckboxState =
    checkedCount === items.length ? true : checkedCount === 0 ? false : 'indeterminate'

  return (
    <Stack>
      <Checkbox
        checked={all}
        label="Select all"
        onCheckedChange={(next) => {
          setItems(items.map(() => next === true))
        }}
      />
      <div className="pl-6">
        <Stack>
          {items.map((checked, index) => (
            <Checkbox
              checked={checked}
              key={index}
              label={`Item ${String(index + 1)}`}
              onCheckedChange={(next) => {
                setItems(
                  items.map((value, position) => (position === index ? next === true : value)),
                )
              }}
            />
          ))}
        </Stack>
      </div>
    </Stack>
  )
}

/** What the indeterminate state is actually for. */
export const SelectAllGroup: Story = {
  render: () => <SelectAll />,
}

/** No visible label — the accessible name has to come from somewhere. */
export const LabelledExternally: Story = {
  args: { 'aria-label': 'Compare this product', label: undefined },
}
