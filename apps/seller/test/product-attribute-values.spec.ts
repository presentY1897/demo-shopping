/**
 * The rule that decides what survives a change of category
 * (QUALITY-GATES Q5 — 순수 로직 분기 100%, TASK-0114 F2).
 *
 * The rule is the screen's alone: the server sees two unrelated requests and
 * could not know a category was ever changed. So there is nowhere else this can
 * be verified, and 「되돌리면 값이 남아 있다」 is a promise made entirely here.
 */

import type { FieldDef } from '@shopping/ui/form'
import { describe, expect, it } from 'vitest'

import type { AttributeDefinitionLike } from '@/lib/products/attribute-values'
import {
  attributeFieldName,
  attributeFields,
  attributeKeyOf,
  attributeValuesFrom,
  carryOverValues,
  fieldSignature,
  formValuesFrom,
} from '@/lib/products/attribute-values'

function definition(overrides: Partial<AttributeDefinitionLike>): AttributeDefinitionLike {
  return {
    key: 'brand',
    label: '브랜드',
    type: 'TEXT',
    options: [],
    isRequired: false,
    ...overrides,
  }
}

const BRAND = definition({})
const FIT = definition({
  key: 'fit',
  label: '핏',
  type: 'SELECT',
  options: ['오버핏', '슬림핏'],
  isRequired: true,
})
const SEASON = definition({
  key: 'season',
  label: '착용 계절',
  type: 'MULTI_SELECT',
  options: ['간절기', '겨울'],
})
const WOOL = definition({ key: 'wool_ratio', label: '울 혼용률', type: 'NUMBER' })
const LINER = definition({ key: 'detachable_liner', label: '탈부착 내피', type: 'BOOLEAN' })

const COAT_FIELDS = attributeFields([BRAND, FIT, SEASON, WOOL, LINER])

describe('naming a definition as a form field', () => {
  it('uses the path the server names in its own refusals', () => {
    // `PRODUCT_ATTRIBUTES_REQUIRED` arrives with `details[].field =
    // "attributes.brand"`, and `serverFieldErrors` places by comparing that
    // string against the form's field names. Any other name would put every
    // server-side attribute refusal at the top of the form (F6b).
    expect(attributeFieldName('brand')).toBe('attributes.brand')
    expect(attributeKeyOf('attributes.brand')).toBe('brand')
  })

  it('says a field is not an attribute when it is not one', () => {
    expect(attributeKeyOf('name')).toBeNull()
  })
})

describe('turning definitions into fields', () => {
  it('maps every type to the control the generator knows', () => {
    expect(COAT_FIELDS.map((field) => field.type)).toEqual([
      'text',
      'select',
      'multiselect',
      'number',
      'boolean',
    ])
  })

  it('orders by position in the answer, not by sortOrder', () => {
    // The API already answers general → specific with shadowing resolved, and
    // `sortOrder` cannot express that — a root's 브랜드 and a leaf's 넥라인 are
    // both 0. Handing over the index makes `resolveFields`' own sort a no-op.
    expect(COAT_FIELDS.map((field) => field.order)).toEqual([0, 1, 2, 3, 4])
  })

  it('carries required through, so the browser asks for what the server will', () => {
    expect(COAT_FIELDS.find((field) => field.key === 'attributes.fit')?.required).toBe(true)
  })

  it('changes its signature when the shape changes and not when the copy does', () => {
    const relabelled = attributeFields([{ ...BRAND, label: '브랜드명', isRequired: true }])

    expect(fieldSignature(relabelled)).toBe(fieldSignature(attributeFields([BRAND])))
    expect(fieldSignature(attributeFields([FIT]))).not.toBe(
      fieldSignature(attributeFields([BRAND])),
    )
  })
})

describe('changing category', () => {
  const typed = {
    'attributes.brand': '루미에르',
    'attributes.fit': '오버핏',
    'attributes.season': ['간절기'],
    'attributes.wool_ratio': '70',
    'attributes.detachable_liner': true,
  }

  it('keeps every value whose key and type survived', () => {
    expect(carryOverValues(typed, COAT_FIELDS)).toEqual(typed)
  })

  it('drops the keys the new category has no definition for', () => {
    // A save carrying a key nothing explains is a 400 — in a draft too
    // (TASK-0113 4장) — so the value cannot simply be kept around.
    expect(carryOverValues(typed, attributeFields([BRAND]))).toEqual({
      'attributes.brand': '루미에르',
    })
  })

  it('gives a key back after a round trip through another category', () => {
    // The whole point (F2): pick 코트 by mistake, type six values, correct it,
    // and get the six back.
    const narrowed = carryOverValues(typed, attributeFields([BRAND]))

    expect(carryOverValues(narrowed, COAT_FIELDS)['attributes.brand']).toBe('루미에르')
    // The ones the narrow category never asked about are gone, and honestly so:
    // nothing held them while they were not on screen.
    expect(carryOverValues(narrowed, COAT_FIELDS)['attributes.fit']).toBe('')
  })

  it('empties a value the new control could not hold', () => {
    // `season` as a `TEXT` elsewhere in the tree. Carrying `['간절기']` into a
    // text box makes the generated schema refuse a field nobody touched.
    const asText = attributeFields([{ ...SEASON, type: 'TEXT', options: [] }])

    expect(carryOverValues(typed, asText)['attributes.season']).toBe('')
  })

  it('empties a choice the new definition no longer offers', () => {
    const narrowed = attributeFields([{ ...FIT, options: ['슬림핏'] }])

    expect(carryOverValues(typed, narrowed)['attributes.fit']).toBe('')
  })

  it('empties a multi-select when any one of its choices is gone', () => {
    const narrowed = attributeFields([{ ...SEASON, options: ['겨울'] }])

    // All or nothing: dropping just 간절기 would silently discard one of the
    // seller's answers, which is worse than asking the question again.
    expect(carryOverValues(typed, narrowed)['attributes.season']).toEqual([])
  })

  it('empties a number that is not one', () => {
    const broken = { 'attributes.wool_ratio': '칠십' }

    expect(carryOverValues(broken, attributeFields([WOOL]))['attributes.wool_ratio']).toBe('')
  })

  it('starts a key nobody has answered from the blank for its type', () => {
    expect(carryOverValues({}, COAT_FIELDS)).toEqual({
      'attributes.brand': '',
      'attributes.fit': '',
      'attributes.season': [],
      'attributes.wool_ratio': '',
      'attributes.detachable_liner': false,
    })
  })

  it('empties a boolean that arrived as something else', () => {
    const broken = { 'attributes.detachable_liner': 'yes' }

    expect(carryOverValues(broken, attributeFields([LINER]))['attributes.detachable_liner']).toBe(
      false,
    )
  })
})

describe('loading a stored listing into the form', () => {
  it('turns a stored number into the text a numeric input holds', () => {
    // `''` has to stay distinguishable from `0`, so the generator holds numbers
    // as strings (`field-def.ts`).
    expect(formValuesFrom({ wool_ratio: 70 }, COAT_FIELDS)['attributes.wool_ratio']).toBe('70')
  })

  it('carries strings, booleans and lists through unchanged', () => {
    const values = formValuesFrom(
      { brand: '루미에르', detachable_liner: true, season: ['겨울'] },
      COAT_FIELDS,
    )

    expect(values['attributes.brand']).toBe('루미에르')
    expect(values['attributes.detachable_liner']).toBe(true)
    expect(values['attributes.season']).toEqual(['겨울'])
  })

  it('blanks a stored value the definition no longer allows', () => {
    // The definition's options moved on after the product was saved.
    expect(formValuesFrom({ fit: '레귤러핏' }, COAT_FIELDS)['attributes.fit']).toBe('')
  })

  it('leaves a key the stored bag never had at its blank', () => {
    expect(formValuesFrom({}, COAT_FIELDS)['attributes.brand']).toBe('')
  })

  it('ignores a field that is not an attribute', () => {
    const withBase: readonly FieldDef[] = [
      ...COAT_FIELDS,
      { key: 'name', label: '이름', type: 'text' },
    ]

    expect(formValuesFrom({}, withBase).name).toBe('')
  })
})

describe('building the bag to send', () => {
  it('leaves a blank answer out rather than sending an empty string', () => {
    // A draft is allowed to be incomplete, and it says so by not carrying the
    // key — which is exactly what `PRODUCT_ATTRIBUTES_REQUIRED` looks for when
    // the listing later goes on sale.
    expect(
      attributeValuesFrom(
        {
          'attributes.brand': '',
          'attributes.season': [],
          'attributes.wool_ratio': '',
          'attributes.fit': '오버핏',
        },
        COAT_FIELDS,
      ),
    ).toEqual({ fit: '오버핏' })
  })

  it('sends a number as a number and a switch as a boolean', () => {
    expect(
      attributeValuesFrom(
        { 'attributes.wool_ratio': 70, 'attributes.detachable_liner': false },
        COAT_FIELDS,
      ),
      // `false` is an answer, not a blank: a switch nobody moved still says
      // "no liner", and dropping it would make the field permanently unset.
    ).toEqual({ wool_ratio: 70, detachable_liner: false })
  })

  it('reads only the keys the current fields ask about', () => {
    // A value left over from a category that has been changed away from must
    // not ride along: the server refuses a key it has no definition for.
    expect(
      attributeValuesFrom({ 'attributes.neckline': '노치드' }, attributeFields([BRAND])),
    ).toEqual({})
  })

  it('ignores a base field sitting in the same values object', () => {
    expect(attributeValuesFrom({ name: '코트' }, COAT_FIELDS)).toEqual({})
  })
})
