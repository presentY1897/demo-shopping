/**
 * TASK-0015 F3 — the focus trap — is the reason this file exists.
 *
 * "Focus stays inside" is asserted by actually walking Tab around the dialog
 * more times than it has focusable elements and checking, after every single
 * press, that the focused element is a descendant of the dialog. A test that
 * pressed Tab once and looked at the result would pass on a dialog with no trap
 * at all.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { Button } from './button'
import { Input } from './input'
import { Modal, ModalClose } from './modal'

function ConfirmModal({ dismissible = true }: { readonly dismissible?: boolean }) {
  return (
    <>
      <Button>Outside before</Button>
      <Modal
        closeLabel="Close"
        description="This cannot be undone."
        dismissible={dismissible}
        footer={
          <>
            <ModalClose>
              <Button variant="outline">Cancel</Button>
            </ModalClose>
            <ModalClose>
              <Button variant="danger">Delete</Button>
            </ModalClose>
          </>
        }
        title="Delete the product"
        trigger={<Button>Open</Button>}
      >
        <Input aria-label="Reason" />
      </Modal>
      <Button>Outside after</Button>
    </>
  )
}

async function open(): Promise<HTMLElement> {
  const user = setupUser()
  await user.click(screen.getByRole('button', { name: 'Open' }))
  return screen.getByRole('dialog')
}

describe('Modal', () => {
  it('opens from its trigger and is named by its title', async () => {
    render(<ConfirmModal />)

    const dialog = await open()

    expect(dialog).toHaveAccessibleName('Delete the product')
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.')
  })

  it('moves focus into the dialog when it opens', async () => {
    render(<ConfirmModal />)

    const dialog = await open()

    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('keeps Tab inside the dialog, in both directions', async () => {
    const user = setupUser()
    render(<ConfirmModal />)

    const dialog = await open()

    // Four focusable elements inside (close, reason, cancel, delete); ten
    // presses forces the wrap-around to happen more than twice.
    for (let press = 0; press < 10; press += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }

    for (let press = 0; press < 10; press += 1) {
      await user.tab({ shift: true })
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
  })

  it('takes the page behind it out of reach entirely', async () => {
    const user = setupUser()
    render(<ConfirmModal />)

    // Captured before opening: once the dialog is up these are hidden from the
    // accessibility tree, which is itself the point of the next assertion.
    const before = screen.getByRole('button', { name: 'Outside before' })
    const after = screen.getByRole('button', { name: 'Outside after' })

    await open()

    expect(screen.queryByRole('button', { name: 'Outside before' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Outside after' })).not.toBeInTheDocument()

    for (let press = 0; press < 12; press += 1) {
      await user.tab()
      expect(document.activeElement).not.toBe(before)
      expect(document.activeElement).not.toBe(after)
    }
  })

  it('closes on Escape and gives focus back to the trigger', async () => {
    const user = setupUser()
    render(<ConfirmModal />)

    await open()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus()
  })

  it('closes from the × button', async () => {
    const user = setupUser()
    render(<ConfirmModal />)

    await open()
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes from a footer button wrapped in ModalClose', async () => {
    const user = setupUser()
    render(<ConfirmModal />)

    await open()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ignores Escape when it is not dismissible', async () => {
    const user = setupUser()
    render(<ConfirmModal dismissible={false} />)

    await open()
    await user.keyboard('{Escape}')

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('lets the user type into a field inside it', async () => {
    const user = setupUser()
    render(<ConfirmModal />)

    await open()
    const reason = screen.getByRole('textbox', { name: 'Reason' })
    await user.type(reason, 'duplicate listing')

    expect(reason).toHaveValue('duplicate listing')
  })
})
