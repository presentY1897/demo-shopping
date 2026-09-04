/**
 * A blocked button has to be inert *and* reachable — the two properties that
 * pull in opposite directions, which is why this component exists at all.
 *
 * The native `disabled` attribute would give the first for free and lose the
 * second silently: nothing in a render assertion notices that a control left the
 * tab order, and the reader who needed the explanation is exactly the one who
 * can no longer get to it.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { GuardedButton } from './guarded-button'

const REASON = 'This role cannot delete categories.'

describe('GuardedButton', () => {
  it('behaves like an ordinary button when nothing blocks it', async () => {
    const user = setupUser()
    const onClick = vi.fn()
    render(<GuardedButton onClick={onClick}>Delete</GuardedButton>)

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not run its handler while blocked', async () => {
    const user = setupUser()
    const onClick = vi.fn()
    render(
      <GuardedButton blocked onClick={onClick} reason={REASON}>
        Delete
      </GuardedButton>,
    )

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.keyboard('{Enter}')

    expect(onClick).not.toHaveBeenCalled()
  })

  it('stays reachable by Tab so the reason can be read', async () => {
    const user = setupUser()
    render(
      <GuardedButton blocked reason={REASON}>
        Delete
      </GuardedButton>,
    )

    await user.tab()

    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button).toHaveFocus()
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('describes itself with the reason, without renaming itself', () => {
    render(
      <GuardedButton blocked reason={REASON}>
        Delete
      </GuardedButton>,
    )

    // `getByRole` matches on the accessible *name*, so finding it under "Delete"
    // is itself the proof that the sentence did not leak into the name.
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveAccessibleDescription(REASON)
  })

  it('does not submit the form it sits in while blocked', async () => {
    const user = setupUser()
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => {
      event.preventDefault()
    })

    render(
      <form onSubmit={onSubmit}>
        <GuardedButton blocked reason={REASON} type="submit">
          Save
        </GuardedButton>
      </form>,
    )

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSubmit).not.toHaveBeenCalled()
  })
})
