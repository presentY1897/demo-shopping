/**
 * The id derivation, checked from both ends: the ids `FormField` renders and
 * the `aria-describedby` it publishes have to agree, and the list must never
 * name an element that is not there (axe `aria-valid-attr-value`).
 */

import { describe, expect, it } from 'vitest'

import { describedBy, fieldIds } from './field-ids'

describe('fieldIds', () => {
  it('derives all three ids from the form id and the field name', () => {
    expect(fieldIds('form1', 'email')).toEqual({
      control: 'form1-email',
      error: 'form1-email-error',
      hint: 'form1-email-hint',
    })
  })

  it('keeps a dotted path intact so two fields cannot collide', () => {
    const nested = fieldIds('f', 'attributes.material')
    const flat = fieldIds('f', 'attributes_material')

    expect(nested.control).not.toBe(flat.control)
  })
})

describe('describedBy', () => {
  const ids = fieldIds('f', 'email')

  it('is undefined when neither a hint nor an error is rendered', () => {
    expect(describedBy(ids, { error: false, hint: false })).toBeUndefined()
  })

  it('names only the hint when there is no error', () => {
    expect(describedBy(ids, { error: false, hint: true })).toBe('f-email-hint')
  })

  it('names only the error when there is no hint', () => {
    expect(describedBy(ids, { error: true, hint: false })).toBe('f-email-error')
  })

  it('reads the hint before the error when both are rendered', () => {
    expect(describedBy(ids, { error: true, hint: true })).toBe('f-email-hint f-email-error')
  })
})
