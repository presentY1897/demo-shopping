/**
 * The toast API is a hook, so the tests drive it the way an app would: a button
 * calls `toast()` in its click handler and the assertions are about what the
 * user then sees and can dismiss.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { Button } from './button'
import { ToastProvider, useToast } from './toast'

function Notifier() {
  const { toast, dismissAll } = useToast()

  return (
    <>
      <Button
        onClick={() => {
          toast({
            description: 'The seller has been notified.',
            duration: Number.POSITIVE_INFINITY,
            title: 'Order cancelled',
            variant: 'success',
          })
        }}
      >
        Cancel order
      </Button>
      <Button onClick={dismissAll}>Clear</Button>
    </>
  )
}

function renderNotifier() {
  return render(
    <ToastProvider closeLabel="Dismiss" regionLabel="Notifications">
      <Notifier />
    </ToastProvider>,
  )
}

describe('Toast', () => {
  it('appears when the app asks for one', async () => {
    const user = setupUser()
    renderNotifier()

    await user.click(screen.getByRole('button', { name: 'Cancel order' }))

    expect(await screen.findByText('Order cancelled')).toBeVisible()
  })

  it('is dismissed by its close button', async () => {
    const user = setupUser()
    renderNotifier()

    await user.click(screen.getByRole('button', { name: 'Cancel order' }))
    await screen.findByText('Order cancelled')

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByText('Order cancelled')).not.toBeInTheDocument()
  })

  it('stacks and clears', async () => {
    const user = setupUser()
    renderNotifier()

    const trigger = screen.getByRole('button', { name: 'Cancel order' })
    await user.click(trigger)
    await user.click(trigger)
    await user.click(trigger)

    expect(await screen.findAllByText('Order cancelled')).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(screen.queryByText('Order cancelled')).not.toBeInTheDocument()
  })

  it('refuses to be used outside its provider', () => {
    // A notification that silently never appears is the failure this prevents.
    expect(() => render(<Notifier />)).toThrow(/ToastProvider/)
  })
})
