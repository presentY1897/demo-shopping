/**
 * `Select` — a single-choice listbox on Radix.
 *
 * The options are a flat array rather than `<Select.Item>` children on purpose:
 * a story can enumerate the states of an array prop and cannot enumerate a
 * `children` slot.
 *
 * The trigger is a `<button>`, not a labelable element, so a wrapping `<label>`
 * would leave it with no accessible name at all. Every story here associates the
 * label explicitly.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Select, SELECT_SIZES } from '../../src/components'
import { Stack } from '../support/layout'

const OPTIONS = [
  { label: 'Outerwear', value: 'outerwear' },
  { label: 'Knitwear', value: 'knitwear' },
  { label: 'Shirts', value: 'shirts' },
  { label: 'Trousers', value: 'trousers' },
  { label: 'Discontinued', value: 'discontinued', disabled: true },
]

const meta = {
  title: 'Components/Select',
  component: Select,
  tags: ['autodocs'],
  args: {
    'aria-label': 'Category',
    options: OPTIONS,
    placeholder: 'Choose a category',
    size: 'md',
  },
  argTypes: {
    size: { control: 'inline-radio', options: [...SELECT_SIZES] },
  },
} satisfies Meta<typeof Select>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Sizes: Story = {
  render: (args) => (
    <Stack>
      {SELECT_SIZES.map((size) => (
        <div className="flex max-w-96 flex-col gap-1" key={size}>
          <span className="text-fg-muted text-sm" id={`select-label-${size}`}>
            {`Category · size="${size}"`}
          </span>
          <Select {...args} aria-labelledby={`select-label-${size}`} size={size} />
        </div>
      ))}
    </Stack>
  ),
}

export const States: Story = {
  render: (args) => (
    <Stack>
      <Select {...args} aria-label="Category · chosen" defaultValue="knitwear" />
      <Select {...args} aria-label="Category · invalid" invalid />
      <Select {...args} aria-label="Category · disabled" disabled />
    </Stack>
  ),
}

/**
 * No options at all, and a list long enough that the popup has to decide where
 * to put itself. `max-h-(--radix-select-content-available-height)` is what stops
 * the second one running off the bottom of a short window.
 */
export const EdgeCases: Story = {
  render: (args) => (
    <Stack>
      <Select {...args} aria-label="Category · empty" options={[]} placeholder="Nothing to pick" />
      <Select
        {...args}
        aria-label="Category · long list"
        options={Array.from({ length: 40 }, (_, index) => ({
          label: `Category ${String(index + 1)}`,
          value: `category-${String(index + 1)}`,
        }))}
      />
      <Select
        {...args}
        aria-label="Category · long label"
        options={[
          {
            label: 'A category name long enough to overflow the trigger it is shown inside',
            value: 'long',
          },
        ]}
        defaultValue="long"
      />
    </Stack>
  ),
}
