import type { AttributeType } from '@shopping/shared'
import { ATTRIBUTE_TEXT_MAX_LENGTH } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import type { AttributeRule } from './attribute-schema.js'
import {
  buildAttributesSchema,
  isAbsent,
  NOT_AN_OBJECT_MESSAGE,
  ROOT_ATTRIBUTE_KEY,
  unknownKeyMessage,
  validateAttributeValues,
  valueSchemaOf,
} from './attribute-schema.js'

/**
 * The generator, one type at a time.
 *
 * This is the file the gate "분기 커버리지 100%" is really about. Every branch
 * here is a value the catalogue will or will not accept, and the cost of getting
 * one wrong is not a red test — it is a `Product.attributes` object that no
 * screen can render and no facet can count, discovered weeks later.
 *
 * So each type is asked twice: what it accepts, and what it refuses. A schema
 * that refuses everything passes the first half of that on its own.
 */

function rule(overrides: Partial<AttributeRule> & { type: AttributeType }): AttributeRule {
  return {
    key: 'material',
    label: '소재',
    options: [],
    isRequired: false,
    ...overrides,
  }
}

/** The issues of a failed validation, or a failure of the test if it passed. */
function issues(rules: readonly AttributeRule[], values: unknown): readonly string[] {
  const result = validateAttributeValues(rules, values)

  if (result.ok) throw new Error(`거부를 기대했지만 통과했습니다: ${JSON.stringify(values)}`)

  return result.issues.map((issue) => `${issue.key}: ${issue.message}`)
}

/** The accepted values, or a failure of the test if it was refused. */
function accepted(rules: readonly AttributeRule[], values: unknown): Record<string, unknown> {
  const result = validateAttributeValues(rules, values)

  if (!result.ok) throw new Error(`통과를 기대했지만 거부되었습니다: ${JSON.stringify(result)}`)

  return result.values
}

describe('isAbsent — the four ways of saying nothing', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['빈 문자열', ''],
    ['빈 배열', []],
  ])('treats %s as absent', (_label, value) => {
    expect(isAbsent(value)).toBe(true)
  })

  it.each([
    ['0', 0],
    ['false', false],
    ['문자열', 'x'],
    ['비어 있지 않은 배열', ['a']],
    ['객체', {}],
  ])('treats %s as a value', (_label, value) => {
    // `0` and `false` are the ones worth pinning down: a truthiness check would
    // drop both, and a required BOOLEAN could then never be answered "no".
    expect(isAbsent(value)).toBe(false)
  })
})

describe('TEXT', () => {
  const rules = [rule({ type: 'TEXT' })]

  it('accepts a string and trims it', () => {
    expect(accepted(rules, { material: '  울 100%  ' })).toEqual({ material: '울 100%' })
  })

  it('refuses a number, naming the label and the key (F2)', () => {
    expect(issues(rules, { material: 100 })).toEqual([
      "material: '소재'(material) 값은 문자열이어야 합니다.",
    ])
  })

  it('refuses a value longer than the cap', () => {
    expect(issues(rules, { material: 'x'.repeat(ATTRIBUTE_TEXT_MAX_LENGTH + 1) })).toEqual([
      `material: '소재'(material) 값은 ${String(ATTRIBUTE_TEXT_MAX_LENGTH)}자 이하여야 합니다.`,
    ])
  })

  it('accepts a value exactly at the cap', () => {
    const value = 'x'.repeat(ATTRIBUTE_TEXT_MAX_LENGTH)

    expect(accepted(rules, { material: value })).toEqual({ material: value })
  })
})

describe('NUMBER', () => {
  const rules = [rule({ key: 'weight', label: '중량', type: 'NUMBER' })]

  it('accepts a number', () => {
    expect(accepted(rules, { weight: 1200 })).toEqual({ weight: 1200 })
  })

  it('refuses a numeric string rather than coercing it (F2)', () => {
    // Coercion is the tempting mistake: `Number('1200')` works, and then
    // `Number('12kg')` is NaN and `Number('')` is 0 — two different errors
    // turned into one plausible looking value.
    expect(issues(rules, { weight: '1200' })).toEqual([
      "weight: '중량'(weight) 값은 숫자여야 합니다.",
    ])
  })

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('refuses %s, which survives typeof but not a JSONB round trip', (_label, value) => {
    // Both come back from JSONB as `null`, so a definition that accepted them
    // would quietly empty a required attribute. `z.number()` refuses them on
    // its own in zod 4, which is why no `.finite()` appears in the generator.
    expect(issues(rules, { weight: value })).toEqual([
      "weight: '중량'(weight) 값은 숫자여야 합니다.",
    ])
  })
})

describe('SELECT', () => {
  const rules = [rule({ key: 'color', label: '색상', type: 'SELECT', options: ['블랙', '화이트'] })]

  it('accepts a defined choice', () => {
    expect(accepted(rules, { color: '블랙' })).toEqual({ color: '블랙' })
  })

  it('refuses a value outside the options and says what they are (F3)', () => {
    expect(issues(rules, { color: '네이비' })).toEqual([
      "color: '색상'(color) 값은 정의된 선택지 중 하나여야 합니다: 블랙, 화이트",
    ])
  })

  it('shortens the message when there are many options', () => {
    const many = Array.from({ length: 12 }, (_unused, index) => `옵션${String(index)}`)

    expect(issues([rule({ type: 'SELECT', options: many })], { material: '없음' })).toEqual([
      `material: '소재'(material) 값은 정의된 선택지 중 하나여야 합니다: ${many.slice(0, 10).join(', ')} 외 2개`,
    ])
  })

  it('refuses everything when the definition has no options', () => {
    // The database refuses to store such a definition
    // (`AttributeDefinition_options_check`); this is what happens if one ever
    // reaches the generator anyway — no value passes, rather than every value.
    expect(issues([rule({ type: 'SELECT' })], { material: '무엇이든' })).toEqual([
      "material: '소재'(material) 값은 정의된 선택지 중 하나여야 합니다: ",
    ])
  })
})

describe('MULTI_SELECT', () => {
  const rules = [
    rule({ key: 'seasons', label: '계절', type: 'MULTI_SELECT', options: ['봄', '여름', '겨울'] }),
  ]

  it('accepts an array of defined choices', () => {
    expect(accepted(rules, { seasons: ['봄', '겨울'] })).toEqual({ seasons: ['봄', '겨울'] })
  })

  it('refuses a bare string — one choice is still an array', () => {
    expect(issues(rules, { seasons: '봄' })).toEqual([
      "seasons: '계절'(seasons) 값은 선택지 배열이어야 합니다.",
    ])
  })

  it('refuses an undefined choice inside the array', () => {
    expect(issues(rules, { seasons: ['봄', '장마'] })).toEqual([
      "seasons: '계절'(seasons) 값은 정의된 선택지 중에서 골라야 합니다: 봄, 여름, 겨울",
    ])
  })

  it('refuses the same choice twice', () => {
    // Not pedantry: a repeated value counts the product twice in the facet
    // count once Meilisearch indexes it (M06).
    expect(issues(rules, { seasons: ['봄', '봄'] })).toEqual([
      "seasons: '계절'(seasons) 값에 같은 선택지가 두 번 들어 있습니다.",
    ])
  })
})

describe('BOOLEAN', () => {
  const rules = [rule({ key: 'waterproof', label: '방수', type: 'BOOLEAN' })]

  it.each([true, false])('accepts %s', (value) => {
    expect(accepted(rules, { waterproof: value })).toEqual({ waterproof: value })
  })

  it('refuses the string "false", which is truthy', () => {
    expect(issues(rules, { waterproof: 'false' })).toEqual([
      "waterproof: '방수'(waterproof) 값은 true 또는 false 여야 합니다.",
    ])
  })
})

describe('required and optional', () => {
  const required = [rule({ type: 'TEXT', isRequired: true })]

  it('accepts an omitted optional attribute', () => {
    expect(accepted([rule({ type: 'TEXT' })], {})).toEqual({})
  })

  it.each([
    ['생략', {}],
    ['null', { material: null }],
    ['빈 문자열', { material: '' }],
    ['undefined', { material: undefined }],
  ])('refuses a required attribute given as %s (F4)', (_label, values) => {
    expect(issues(required, values)).toEqual([
      "material: 필수 속성 '소재'(material) 값이 없습니다.",
    ])
  })

  it('refuses a required MULTI_SELECT given as an empty array (F4)', () => {
    const rules = [
      rule({
        key: 'seasons',
        label: '계절',
        type: 'MULTI_SELECT',
        options: ['봄'],
        isRequired: true,
      }),
    ]

    expect(issues(rules, { seasons: [] })).toEqual([
      "seasons: 필수 속성 '계절'(seasons) 값이 없습니다.",
    ])
  })

  it('drops an absent optional value instead of storing it', () => {
    expect(accepted([rule({ type: 'TEXT' })], { material: '' })).toEqual({})
  })
})

describe('keys with no definition', () => {
  it('refuses one, naming it (F5)', () => {
    expect(issues([rule({ type: 'TEXT' })], { material: '울', colour: '블랙' })).toEqual([
      `colour: ${unknownKeyMessage('colour')}`,
    ])
  })

  it('names every one of them', () => {
    expect(issues([], { a: 1, b: 2 })).toEqual([
      `a: ${unknownKeyMessage('a')}`,
      `b: ${unknownKeyMessage('b')}`,
    ])
  })

  it('accepts an empty object when nothing is defined', () => {
    expect(accepted([], {})).toEqual({})
  })
})

describe('the value bag itself', () => {
  it.each([
    ['null', null],
    ['숫자', 5],
    ['배열', ['material']],
    ['문자열', 'material'],
  ])('refuses %s, which is not an attribute object', (_label, values) => {
    expect(issues([rule({ type: 'TEXT' })], values)).toEqual([
      `${ROOT_ATTRIBUTE_KEY}: ${NOT_AN_OBJECT_MESSAGE}`,
    ])
  })
})

describe('reporting every problem at once', () => {
  it('answers with one issue per attribute, not just the first', () => {
    const rules = [
      rule({ type: 'TEXT', isRequired: true }),
      rule({ key: 'color', label: '색상', type: 'SELECT', options: ['블랙'] }),
      rule({ key: 'weight', label: '중량', type: 'NUMBER' }),
    ]

    // A form that highlights one field per round trip makes an operator submit
    // four times to learn about four mistakes.
    expect(issues(rules, { color: '네이비', weight: 'x', bogus: true })).toEqual([
      "material: 필수 속성 '소재'(material) 값이 없습니다.",
      "color: '색상'(color) 값은 정의된 선택지 중 하나여야 합니다: 블랙",
      "weight: '중량'(weight) 값은 숫자여야 합니다.",
      `bogus: ${unknownKeyMessage('bogus')}`,
    ])
  })
})

describe('the pieces on their own', () => {
  it('exposes the schema of one attribute', () => {
    const schema = valueSchemaOf(rule({ type: 'BOOLEAN' }))

    expect(schema.safeParse(true).success).toBe(true)
    expect(schema.safeParse('true').success).toBe(false)
  })

  it('builds an object schema that a caller can parse with directly', () => {
    const schema = buildAttributesSchema([rule({ type: 'TEXT', isRequired: true })])

    expect(schema.safeParse({ material: '울' })).toEqual({
      success: true,
      data: { material: '울' },
    })
    expect(schema.safeParse({}).success).toBe(false)
  })

  it('reflects a definition added to the rules on the very next call (F6)', () => {
    // The generator holds no state, so "즉시 반영" is a property of the design
    // rather than a cache that has to be invalidated.
    const before = validateAttributeValues([], {})
    const after = validateAttributeValues([rule({ type: 'TEXT', isRequired: true })], {})

    expect(before.ok).toBe(true)
    expect(after.ok).toBe(false)
  })
})
