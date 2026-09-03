/**
 * The zod adapter. Pure input → output, so there is nothing to render and
 * nothing to mock.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  fieldPathOf,
  mergeValidationErrors,
  validateWithSchema,
  validationErrorsFrom,
} from './field-errors'

describe('fieldPathOf', () => {
  it('joins every segment with a dot, indices included', () => {
    expect(fieldPathOf(['items', 0, 'price'])).toBe('items.0.price')
  })

  it('is the empty string for an issue about the whole object', () => {
    expect(fieldPathOf([])).toBe('')
  })
})

describe('validationErrorsFrom', () => {
  it('keeps the first message for a field and drops the rest', () => {
    const { fieldErrors } = validationErrorsFrom([
      { message: 'too short', path: ['name'] },
      { message: 'wrong format', path: ['name'] },
    ])

    expect(fieldErrors).toEqual({ name: 'too short' })
  })

  it('collects issues that name no field separately', () => {
    const { fieldErrors, formErrors } = validationErrorsFrom([
      { message: 'the dates overlap', path: [] },
      { message: 'required', path: ['slug'] },
    ])

    expect(formErrors).toEqual(['the dates overlap'])
    expect(fieldErrors).toEqual({ slug: 'required' })
  })
})

describe('validateWithSchema', () => {
  const schema = z.object({
    name: z.string().min(1, 'NAME_REQUIRED'),
    slug: z.string().regex(/^[a-z-]+$/, 'SLUG_FORMAT'),
  })

  it('returns the parsed data when the values pass', () => {
    const result = validateWithSchema(schema, { name: 'Coat', slug: 'coat' })

    expect(result).toEqual({ data: { name: 'Coat', slug: 'coat' }, success: true })
  })

  it('reports one message per offending field', () => {
    const result = validateWithSchema(schema, { name: '', slug: 'Coat Outer' })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.fieldErrors).toEqual({ name: 'NAME_REQUIRED', slug: 'SLUG_FORMAT' })
    expect(result.formErrors).toEqual([])
  })

  it('reports a whole-object refinement as a form error', () => {
    const refined = z
      .object({ from: z.number(), to: z.number() })
      .refine((value) => value.from <= value.to, 'RANGE_REVERSED')

    const result = validateWithSchema(refined, { from: 9, to: 1 })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.formErrors).toEqual(['RANGE_REVERSED'])
    expect(result.fieldErrors).toEqual({})
  })

  it('places a nested issue on its dotted path', () => {
    const nested = z.object({ attributes: z.object({ material: z.string().min(1, 'REQUIRED') }) })

    const result = validateWithSchema(nested, { attributes: { material: '' } })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.fieldErrors).toEqual({ 'attributes.material': 'REQUIRED' })
  })
})

describe('mergeValidationErrors', () => {
  it('lets the later set win per field and keeps both form errors', () => {
    const merged = mergeValidationErrors(
      { fieldErrors: { a: 'first', b: 'kept' }, formErrors: ['one'] },
      { fieldErrors: { a: 'second' }, formErrors: ['two'] },
    )

    expect(merged).toEqual({
      fieldErrors: { a: 'second', b: 'kept' },
      formErrors: ['one', 'two'],
    })
  })
})
