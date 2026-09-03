/**
 * Button behaviour, exercised through the keyboard and the pointer.
 *
 * The interesting case is `loading`: QUALITY-GATES U3 asks that a submit cannot
 * be fired twice, and the implementation deliberately does *not* use the native
 * `disabled` attribute, so the block has to be verified rather than assumed.
 */

import { render, screen } from '@testing-library/react'
import type { FormEvent } from 'react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { Button } from './button'

describe('Button', () => {
  it('runs its handler when clicked', async () => {
    const user = setupUser()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('is reachable by Tab and fires on Enter and on Space', async () => {
    const user = setupUser()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)

    await user.tab()
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()

    await user.keyboard('{Enter}')
    await user.keyboard(' ')

    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('submits the form it belongs to', async () => {
    const user = setupUser()
    const onSubmit = vi.fn((event: FormEvent) => {
      event.preventDefault()
    })

    render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Send</Button>
      </form>,
    )

    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('does nothing at all when disabled', async () => {
    const user = setupUser()
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onClick).not.toHaveBeenCalled()
  })

  describe('while loading', () => {
    function SubmitOnce({ onSubmit }: { readonly onSubmit: () => void }) {
      const [pending, setPending] = useState(false)

      return (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit()
            setPending(true)
          }}
        >
          <Button loading={pending} type="submit">
            Send
          </Button>
        </form>
      )
    }

    it('accepts the first submit and blocks every one after it', async () => {
      const user = setupUser()
      const onSubmit = vi.fn()
      render(<SubmitOnce onSubmit={onSubmit} />)

      const button = screen.getByRole('button', { name: 'Send' })
      await user.click(button)
      await user.click(button)
      await user.click(button)

      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    it('blocks the keyboard the same way as the pointer', async () => {
      const user = setupUser()
      const onSubmit = vi.fn()
      render(<SubmitOnce onSubmit={onSubmit} />)

      await user.tab()
      await user.keyboard('{Enter}')
      await user.keyboard('{Enter}')
      await user.keyboard(' ')

      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    it('keeps the button focused, so the keyboard user is not thrown to the top of the page', async () => {
      const user = setupUser()
      render(<SubmitOnce onSubmit={() => undefined} />)

      const button = screen.getByRole('button', { name: 'Send' })
      await user.tab()
      await user.keyboard('{Enter}')

      expect(button).toHaveFocus()
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).toHaveAttribute('aria-busy', 'true')
    })
  })
})
