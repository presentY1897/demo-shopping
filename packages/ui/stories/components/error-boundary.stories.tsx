/**
 * `ErrorBoundary` — one broken row instead of a blank page.
 *
 * React unmounts the whole tree when a render throws and nothing catches it. The
 * stories below are worth looking at side by side: the fallback replaces the
 * panel, and everything around it is still there.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { Button, ErrorBoundary, ErrorState } from '../../src/components'
import { Stack } from '../support/layout'

function OrderRow({ broken }: { readonly broken: boolean }) {
  if (broken) throw new Error('total is undefined')
  return <p className="text-fg text-sm">Order 20260903-0001 · ₩120,000</p>
}

interface ConsoleProps {
  readonly broken: boolean
  /** Fixes the underlying cause. Resetting without it would only re-throw. */
  readonly onRecover?: () => void
}

function Console({ broken, onRecover }: ConsoleProps) {
  return (
    <Stack>
      <p className="text-fg-muted text-sm">Seller console — the rest of the page</p>
      <ErrorBoundary
        fallback={({ error, reset }) => (
          <ErrorState
            detail={error.message}
            onRetry={() => {
              onRecover?.()
              reset()
            }}
            retryLabel="Reload this panel"
            title="This panel could not be shown"
          />
        )}
      >
        <OrderRow broken={broken} />
      </ErrorBoundary>
      <p className="text-fg-muted text-sm">…and it is still usable.</p>
    </Stack>
  )
}

/**
 * Throws on demand rather than on render, so the panel can be watched breaking.
 * `reset` alone would only re-throw, so recovering also has to fix the cause —
 * which is why the boundary takes a `resetKeys` prop for the real cases.
 */
function BreakablePanel() {
  const [broken, setBroken] = useState(false)

  return (
    <Stack>
      <Button
        onClick={() => {
          setBroken(true)
        }}
        variant="danger"
      >
        Break the panel
      </Button>
      <Console
        broken={broken}
        onRecover={() => {
          setBroken(false)
        }}
      />
    </Stack>
  )
}

const meta = {
  title: 'Components/ErrorBoundary',
  component: Console,
  tags: ['autodocs'],
  args: { broken: false },
} satisfies Meta<typeof Console>

export default meta

type Story = StoryObj<typeof meta>

/** Nothing thrown: the children render untouched. */
export const Healthy: Story = {}

/** Press the button and watch only the panel go. */
export const Caught: Story = {
  render: () => <BreakablePanel />,
}
