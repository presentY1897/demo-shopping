/**
 * The dynamic form generator, exhaustively.
 *
 * QUALITY-GATES Q5 puts a validator in the 순수 로직 row — branch coverage 100%,
 * input to output, nothing mocked — and `vitest.config.mjs` holds this file's
 * subject to that number. It is the right place for it: this is the only code
 * that decides what an attribute definition *is* on the client, and a branch
 * nothing reaches is a rule nothing checks.
 */

import { describe, expect, it } from 'vitest'

import type { FieldDef, FieldMessages, ResolvedField } from './field-def'
import { FIELD_TYPES, initialValuesForFields, resolveFields, schemaForFields } from './field-def'

const messages: FieldMessages = {
  invalidChoice: (field: ResolvedField) => `CHOICE:${field.key}`,
  invalidNumber: (field: ResolvedField) => `NUMBER:${field.key}`,
  required: (field: ResolvedField) => `REQUIRED:${field.key}`,
}

const SIZES = [
  { label: 'S', value: 's' },
  { label: 'M', value: 'm' },
]

/** One definition of every type, which is what F5 asks to be rendered. */
const FIVE: readonly FieldDef[] = [
  { key: 'material', label: '소재', order: 1, required: true, type: 'text' },
  { key: 'weight', label: '중량', order: 2, type: 'number' },
  { key: 'size', label: '사이즈', options: SIZES, order: 3, required: true, type: 'select' },
  { key: 'colors', label: '색상', options: SIZES, order: 4, type: 'multiselect' },
  { key: 'washable', label: '세탁 가능', order: 5, type: 'boolean' },
]

describe('resolveFields', () => {
  it('covers every declared type', () => {
    expect(FIVE.map((def) => def.type).sort()).toEqual([...FIELD_TYPES].sort())
  })

  it('maps each type to its control', () => {
    expect(
      Object.fromEntries(resolveFields(FIVE).map((field) => [field.type, field.control])),
    ).toEqual({
      boolean: 'checkbox',
      multiselect: 'checkbox-group',
      number: 'number-input',
      select: 'select',
      text: 'input',
    })
  })

  it('fills the defaults a definition may leave out', () => {
    const [field] = resolveFields([{ key: 'note', label: '메모', type: 'text' }])

    expect(field).toEqual({
      control: 'input',
      hint: undefined,
      key: 'note',
      label: '메모',
      options: [],
      order: 0,
      placeholder: undefined,
      required: false,
      type: 'text',
    })
  })

  it('keeps the values a definition does supply', () => {
    const [field] = resolveFields([
      {
        hint: '센티미터',
        key: 'length',
        label: '길이',
        options: SIZES,
        order: 7,
        placeholder: '0',
        required: true,
        type: 'number',
      },
    ])

    expect(field).toMatchObject({
      hint: '센티미터',
      options: SIZES,
      order: 7,
      placeholder: '0',
      required: true,
    })
  })

  it('orders by `order`', () => {
    const keys = resolveFields([
      { key: 'c', label: 'C', order: 30, type: 'text' },
      { key: 'a', label: 'A', order: 10, type: 'text' },
      { key: 'b', label: 'B', order: 20, type: 'text' },
    ]).map((field) => field.key)

    expect(keys).toEqual(['a', 'b', 'c'])
  })

  it('breaks a tie on the key, so the input order cannot change the result', () => {
    const forwards = resolveFields([
      { key: 'zeta', label: 'Z', type: 'text' },
      { key: 'alpha', label: 'A', type: 'text' },
    ]).map((field) => field.key)

    const backwards = resolveFields([
      { key: 'alpha', label: 'A', type: 'text' },
      { key: 'zeta', label: 'Z', type: 'text' },
    ]).map((field) => field.key)

    expect(forwards).toEqual(['alpha', 'zeta'])
    expect(backwards).toEqual(forwards)
  })

  it('returns nothing for no definitions', () => {
    expect(resolveFields([])).toEqual([])
  })
})

describe('initialValuesForFields', () => {
  it('gives every type an empty value that means "not answered"', () => {
    expect(initialValuesForFields(FIVE)).toEqual({
      colors: [],
      material: '',
      size: '',
      washable: false,
      weight: '',
    })
  })
})

describe('schemaForFields', () => {
  const schema = schemaForFields(FIVE, messages)

  it('accepts a fully answered form', () => {
    const result = schema.safeParse({
      colors: ['s'],
      material: '울 100%',
      size: 'm',
      washable: true,
      weight: '820',
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({
      colors: ['s'],
      material: '울 100%',
      size: 'm',
      washable: true,
      weight: 820,
    })
  })

  it('accepts the blank form for the optional fields and reports the required ones', () => {
    const result = schema.safeParse(initialValuesForFields(FIVE))

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.message).sort()).toEqual([
      'REQUIRED:material',
      'REQUIRED:size',
    ])
  })

  describe('text', () => {
    const text = schemaForFields(
      [
        { key: 'required', label: 'R', required: true, type: 'text' },
        { key: 'optional', label: 'O', type: 'text' },
      ],
      messages,
    )

    it('rejects whitespace for a required field and trims what it keeps', () => {
      expect(text.safeParse({ optional: '  ', required: '   ' }).error?.issues[0]?.message).toBe(
        'REQUIRED:required',
      )
      expect(text.safeParse({ optional: ' x ', required: ' y ' }).data).toEqual({
        optional: 'x',
        required: 'y',
      })
    })

    it('lets an optional field stay empty', () => {
      expect(text.safeParse({ optional: '', required: 'y' }).success).toBe(true)
    })
  })

  describe('number', () => {
    const number = schemaForFields(
      [
        { key: 'required', label: 'R', required: true, type: 'number' },
        { key: 'optional', label: 'O', type: 'number' },
      ],
      messages,
    )

    it('reads the string an input gives it', () => {
      expect(number.safeParse({ optional: '', required: '12.5' }).data).toEqual({ required: 12.5 })
    })

    it('separates "left blank" from "not a number"', () => {
      expect(number.safeParse({ required: '' }).error?.issues[0]?.message).toBe('REQUIRED:required')
      expect(number.safeParse({ required: 'abc' }).error?.issues[0]?.message).toBe(
        'NUMBER:required',
      )
    })

    it('rejects a non-number in an optional field but accepts it being absent', () => {
      expect(number.safeParse({ optional: 'abc', required: '1' }).error?.issues[0]?.message).toBe(
        'NUMBER:optional',
      )
      expect(number.safeParse({ optional: null, required: '1' }).success).toBe(true)
    })
  })

  describe('select', () => {
    const select = schemaForFields(
      [
        { key: 'required', label: 'R', options: SIZES, required: true, type: 'select' },
        { key: 'optional', label: 'O', options: SIZES, type: 'select' },
      ],
      messages,
    )

    it('accepts a defined option and rejects one that is not', () => {
      expect(select.safeParse({ optional: '', required: 's' }).success).toBe(true)
      expect(select.safeParse({ required: 'xl' }).error?.issues[0]?.message).toBe('CHOICE:required')
    })

    it('reports an unanswered required select as required, not as a bad choice', () => {
      expect(select.safeParse({ required: '' }).error?.issues[0]?.message).toBe('REQUIRED:required')
    })

    it('rejects a bad value in an optional select', () => {
      expect(select.safeParse({ optional: 'xl', required: 's' }).error?.issues[0]?.message).toBe(
        'CHOICE:optional',
      )
    })

    it('accepts nothing at all when the definition lists no options', () => {
      const empty = schemaForFields(
        [{ key: 'broken', label: 'B', required: true, type: 'select' }],
        messages,
      )

      expect(empty.safeParse({ broken: 's' }).success).toBe(false)
      expect(empty.safeParse({ broken: '' }).error?.issues[0]?.message).toBe('REQUIRED:broken')
    })
  })

  describe('multiselect', () => {
    const multi = schemaForFields(
      [
        { key: 'required', label: 'R', options: SIZES, required: true, type: 'multiselect' },
        { key: 'optional', label: 'O', options: SIZES, type: 'multiselect' },
      ],
      messages,
    )

    it('needs at least one choice when required and none when not', () => {
      expect(multi.safeParse({ optional: [], required: [] }).error?.issues[0]?.message).toBe(
        'REQUIRED:required',
      )
      expect(multi.safeParse({ optional: [], required: ['s'] }).success).toBe(true)
    })

    it('rejects a value outside the options', () => {
      expect(multi.safeParse({ optional: ['xl'], required: ['s'] }).success).toBe(false)
    })
  })

  describe('boolean', () => {
    const boolean = schemaForFields(
      [
        { key: 'required', label: 'R', required: true, type: 'boolean' },
        { key: 'optional', label: 'O', type: 'boolean' },
      ],
      messages,
    )

    it('accepts both answers — a checkbox always has one', () => {
      expect(boolean.safeParse({ optional: true, required: false }).success).toBe(true)
    })

    it('rejects a value that is not a boolean', () => {
      expect(
        boolean.safeParse({ optional: false, required: 'yes' }).error?.issues[0]?.message,
      ).toBe('REQUIRED:required')
    })
  })
})
