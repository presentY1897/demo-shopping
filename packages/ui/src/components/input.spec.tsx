/**
 * Typing, not markup. The error state is asserted through `aria-invalid`,
 * because that is the part a screen reader consumes — the red border is a token
 * lookup and is verified by the token specs, not here.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { Input } from './input'
import { Textarea } from './textarea'

describe('Input', () => {
  it('accepts what the user types', async () => {
    const user = setupUser()
    render(<Input aria-label="Email" />)

    const field = screen.getByRole('textbox', { name: 'Email' })
    await user.type(field, 'buyer@example.test')

    expect(field).toHaveValue('buyer@example.test')
  })

  it('is reached by Tab in document order', async () => {
    const user = setupUser()
    render(
      <>
        <Input aria-label="First" />
        <Input aria-label="Second" />
      </>,
    )

    await user.tab()
    expect(screen.getByRole('textbox', { name: 'First' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('textbox', { name: 'Second' })).toHaveFocus()
  })

  it('announces an invalid value to assistive technology', () => {
    render(<Input aria-label="Email" invalid />)

    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInvalid()
  })

  it('refuses input when disabled', async () => {
    const user = setupUser()
    render(<Input aria-label="Email" disabled />)

    const field = screen.getByRole('textbox', { name: 'Email' })
    await user.type(field, 'nope')

    expect(field).toHaveValue('')
  })
})

describe('Textarea', () => {
  it('keeps the line breaks the user typed', async () => {
    const user = setupUser()
    render(<Textarea aria-label="Message" />)

    const field = screen.getByRole('textbox', { name: 'Message' })
    await user.type(field, 'first{Enter}second')

    expect(field).toHaveValue('first\nsecond')
  })

  it('announces an invalid value to assistive technology', () => {
    render(<Textarea aria-label="Message" invalid />)

    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInvalid()
  })
})
