/**
 * `EmptyState` — the branch a developer with seed data never sees.
 *
 * It announces itself politely, because a list usually becomes empty *because
 * the reader did something*: applied a filter, typed a search. Silence reads as
 * "the page did not respond".
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button, EmptyState } from '../../src/components'
import { Stack } from '../support/layout'

const meta = {
  title: 'Components/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
  args: { title: 'No orders yet' },
} satisfies Meta<typeof EmptyState>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithDescription: Story = {
  args: {
    description: 'Orders appear here as soon as a buyer checks out.',
  },
}

/**
 * The version that matters: an empty state after a filter has to offer the way
 * back out of it, or the reader is stuck looking at nothing.
 */
export const WithAction: Story = {
  args: {
    description: 'No product matches the filters you selected.',
    title: 'No results',
    action: <Button variant="outline">Clear filters</Button>,
  },
}

/** The illustration is a prop: domain icons belong to the apps, not here. */
export const WithIcon: Story = {
  args: {
    icon: (
      <svg aria-hidden="true" className="size-8" fill="none" viewBox="0 0 24 24">
        <path
          d="M4 7h16v12H4zM4 7l2-3h12l2 3"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth={1.5}
        />
      </svg>
    ),
  },
}

/** A long title and a long description still centre and wrap. */
export const EdgeCases: Story = {
  render: (args) => (
    <Stack>
      <EmptyState
        {...args}
        description="Nothing matched this combination of category, colour, size, price band and delivery option. Removing one of them usually helps."
        title="No product matches every filter you have selected right now"
      />
    </Stack>
  ),
}
