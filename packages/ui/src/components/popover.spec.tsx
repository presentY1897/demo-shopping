/**
 * A popover holds focusable content, so the questions are the dialog ones —
 * does focus go in, does Escape bring it back — with one difference that is
 * asserted explicitly: the page behind stays reachable, because a popover is
 * not modal.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { Button } from './button'
import { Input } from './input'
import { Popover } from './popover'

function CouponPopover() {
  return (
    <>
      <Popover closeLabel="Close" title="Coupon" trigger={<Button>Enter a coupon</Button>}>
        <Input aria-label="Coupon code" />
        <Button>Apply</Button>
      </Popover>
      <Button>Elsewhere</Button>
    </>
  )
}

describe('Popover', () => {
  it('opens from its trigger and puts focus inside', async () => {
    const user = setupUser()
    render(<CouponPopover />)

    await user.click(screen.getByRole('button', { name: 'Enter a coupon' }))

    const panel = await screen.findByRole('dialog')
    expect(panel).toContainElement(document.activeElement as HTMLElement)
  })

  it('opens from the keyboard', async () => {
    const user = setupUser()
    render(<CouponPopover />)

    await user.tab()
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('takes input and closes on Escape, returning focus to the trigger', async () => {
    const user = setupUser()
    render(<CouponPopover />)

    await user.click(screen.getByRole('button', { name: 'Enter a coupon' }))
    await screen.findByRole('dialog')

    const code = screen.getByRole('textbox', { name: 'Coupon code' })
    await user.type(code, 'WELCOME10')
    expect(code).toHaveValue('WELCOME10')

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enter a coupon' })).toHaveFocus()
  })

  it('leaves the rest of the page usable, unlike a modal', async () => {
    const user = setupUser()
    render(<CouponPopover />)

    await user.click(screen.getByRole('button', { name: 'Enter a coupon' }))
    await screen.findByRole('dialog')

    expect(screen.getByRole('button', { name: 'Elsewhere' })).toBeInTheDocument()
  })

  it('closes from its × button', async () => {
    const user = setupUser()
    render(<CouponPopover />)

    await user.click(screen.getByRole('button', { name: 'Enter a coupon' }))
    await screen.findByRole('dialog')

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
