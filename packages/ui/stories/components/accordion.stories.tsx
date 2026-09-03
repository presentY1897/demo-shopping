/**
 * `Accordion` — sections that open and close.
 *
 * `type` is a discriminated union rather than a boolean pair: `single` carries a
 * string value and `multiple` an array, and narrowing the union is what keeps
 * both honest without a cast.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Accordion } from '../../src/components'

const ITEMS = [
  {
    content: <p>Orders are split per seller, so each parcel is tracked on its own.</p>,
    title: 'Why did my order arrive in two parcels?',
    value: 'split',
  },
  {
    content: <p>Within seven days of delivery, unworn and with the tags attached.</p>,
    title: 'How long do I have to return something?',
    value: 'returns',
  },
  {
    content: <p>Settlement runs weekly once the claim window has closed.</p>,
    title: 'When is a seller paid?',
    value: 'settlement',
  },
]

const meta = {
  title: 'Components/Accordion',
  component: Accordion,
  tags: ['autodocs'],
  args: { items: ITEMS, type: 'single' },
} satisfies Meta<typeof Accordion>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** One open at a time, and collapsible so the last one can be closed again. */
export const SingleOpen: Story = {
  args: { collapsible: true, defaultValue: 'split', type: 'single' },
}

export const MultipleOpen: Story = {
  args: { defaultValue: ['split', 'returns'], type: 'multiple' },
}

export const States: Story = {
  args: {
    items: [
      ...ITEMS,
      {
        content: <p>Not available.</p>,
        disabled: true,
        title: 'Disabled section',
        value: 'disabled',
      },
    ],
  },
}

/** A title that wraps, and a body long enough to push the rest of the list down. */
export const EdgeCases: Story = {
  args: {
    defaultValue: 'long',
    items: [
      {
        content: (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 10 }, (_, index) => (
              <p key={index}>{`Paragraph ${String(index + 1)}`}</p>
            ))}
          </div>
        ),
        title:
          'A question long enough to wrap onto a second line inside the trigger it is written in',
        value: 'long',
      },
      ...ITEMS,
    ],
  },
}
