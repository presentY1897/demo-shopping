/**
 * `ErrorState` — because "결과가 없습니다" for a 500 is worse than an error.
 *
 * An empty list after a failed request tells the reader their search was fine
 * and there is nothing to find, so they stop looking. This is assertive
 * (`role="alert"`) where `EmptyState` is polite, and the retry label is required
 * by the type whenever a retry handler is given.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button, ErrorState } from '../../src/components'

const meta = {
  title: 'Components/ErrorState',
  component: ErrorState,
  tags: ['autodocs'],
  args: { title: 'Could not load your orders' },
} satisfies Meta<typeof ErrorState>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const WithRetry: Story = {
  args: {
    description: 'The server did not answer in time.',
    onRetry: () => undefined,
    retryLabel: 'Try again',
  },
}

/**
 * The technical detail sits apart from the human sentence, so support can read
 * a request id back without the sentence turning into a stack trace.
 */
export const WithDetail: Story = {
  args: {
    description: 'The server did not answer in time.',
    detail: 'req_01H9Z8QYV3 · 504',
    onRetry: () => undefined,
    retryLabel: 'Try again',
  },
}

/** Retrying is not always the answer — sometimes the way out is somewhere else. */
export const WithSecondaryAction: Story = {
  args: {
    description: 'This order no longer exists.',
    action: <Button variant="ghost">Back to orders</Button>,
    title: 'Order not found',
  },
}
