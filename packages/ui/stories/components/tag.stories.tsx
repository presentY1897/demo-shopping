/**
 * `Tag` — a chip the user put there and can take back off.
 *
 * Distinct from `Badge` because it is removable: a badge reports state, a tag is
 * a choice. `removeLabel` is required *by the type* whenever `onRemove` is
 * passed, so the remove button cannot end up without an accessible name.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { Tag, TAG_VARIANTS } from '../../src/components'
import { Row } from '../support/layout'

const meta = {
  title: 'Components/Tag',
  component: Tag,
  tags: ['autodocs'],
  args: { children: 'Under ₩50,000', variant: 'neutral' },
  argTypes: {
    variant: { control: 'inline-radio', options: [...TAG_VARIANTS] },
  },
} satisfies Meta<typeof Tag>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Variants: Story = {
  render: (args) => (
    <Row>
      {TAG_VARIANTS.map((variant) => (
        <Tag {...args} key={variant} variant={variant}>
          {variant}
        </Tag>
      ))}
    </Row>
  ),
}

function RemovableFilters() {
  const [filters, setFilters] = useState<readonly string[]>([
    'Outerwear',
    'Under ₩50,000',
    'Free delivery',
    'In stock',
  ])

  return (
    <Row>
      {filters.map((filter) => (
        <Tag
          key={filter}
          onRemove={() => {
            setFilters(filters.filter((value) => value !== filter))
          }}
          removeLabel={`Remove filter ${filter}`}
          variant="primary"
        >
          {filter}
        </Tag>
      ))}
      {filters.length === 0 ? <span className="text-fg-subtle text-sm">No filters</span> : null}
    </Row>
  )
}

/**
 * A removable tag grows to the touch floor because it contains a control; a
 * static one is just text and does not need to.
 */
export const Removable: Story = {
  render: () => <RemovableFilters />,
}

export const EdgeCases: Story = {
  render: (args) => (
    <div className="flex max-w-96 flex-wrap gap-2">
      <Tag {...args}>1</Tag>
      <Tag {...args} onRemove={() => undefined} removeLabel="Remove this filter">
        A filter label long enough to wrap the row it sits in
      </Tag>
    </div>
  ),
}
