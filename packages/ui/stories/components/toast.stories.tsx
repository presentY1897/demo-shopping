/**
 * `ToastProvider` and `useToast` — transient feedback.
 *
 * The provider is the component; the toast is what `useToast()` produces from
 * inside it. Radix owns the live region, the swipe, the timeout and the close
 * button, so a dismissal has one path however it was triggered.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button, ToastProvider, TOAST_VARIANTS, useToast } from '../../src/components'
import { Row } from '../support/layout'

function Trigger({ duration }: { readonly duration?: number }) {
  const { toast, dismissAll } = useToast()

  return (
    <Row>
      {TOAST_VARIANTS.map((variant) => (
        <Button
          key={variant}
          onClick={() => {
            toast({
              description: 'The seller has been notified.',
              duration,
              title: `Order updated · ${variant}`,
              variant,
            })
          }}
          variant="outline"
        >
          {variant}
        </Button>
      ))}
      <Button onClick={dismissAll} variant="ghost">
        Dismiss all
      </Button>
    </Row>
  )
}

const meta = {
  title: 'Components/Toast',
  component: ToastProvider,
  tags: ['autodocs'],
  args: {
    closeLabel: 'Close',
    regionLabel: 'Notifications',
    children: <Trigger />,
  },
} satisfies Meta<typeof ToastProvider>

export default meta

type Story = StoryObj<typeof meta>

/** Press a button: the toast appears bottom right and dismisses itself. */
export const Default: Story = {}

/** A long-lived toast, for a message the user has to be able to finish reading. */
export const LongDuration: Story = {
  args: { children: <Trigger duration={60_000} />, duration: 60_000 },
}
