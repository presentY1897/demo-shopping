/**
 * The parts of the attribute console that decide something before anything is
 * drawn — QUALITY-GATES Q5's 순수 로직 row.
 *
 * Each of these produces an answer a screen then obeys: which category is
 * offered, which order a generated form asks its questions in, whether a choice
 * list is acceptable, what a move exchanges. A missed branch in any of them does
 * not turn a test red — it renders a form in the wrong order, or accepts a
 * definition the API is about to refuse. `vitest.config.mjs` holds the four
 * files to 100% branch coverage for that reason.
 */

import type { EffectiveAttribute } from '@shopping/shared'
import { attributeTypes, optionIssues } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { categoryChoices, choiceById, choiceName } from '@/lib/attributes/categories'
import { applySwap, ownAttributes, planSwap } from '@/lib/attributes/order'
import { optionProblems } from '@/lib/attributes/options'
import type { AttributeDraft } from '@/lib/attributes/preview'
import { attributeFields, fieldSignature, previewAttributes } from '@/lib/attributes/preview'
import { fill } from '@/lib/attributes/text'
import type { CategoryRow } from '@/lib/categories/tree'

function category(
  id: number,
  name: string,
  parentId: number | null,
  sortOrder = 0,
  isActive = true,
): CategoryRow {
  return {
    id,
    parentId,
    name,
    slug: `c${String(id)}`,
    sortOrder,
    isActive,
    productCount: 0,
    version: 0,
  }
}

const TREE: readonly CategoryRow[] = [
  category(1, '여성', null, 0),
  category(2, '아우터', 1, 0),
  category(3, '코트', 2, 0),
  category(4, '재킷', 2, 1, false),
  category(5, '남성', null, 1),
]

function attribute(
  id: number,
  key: string,
  overrides: Partial<EffectiveAttribute> = {},
): EffectiveAttribute {
  return {
    id,
    categoryId: 3,
    key,
    label: key,
    type: 'TEXT',
    options: [],
    isRequired: false,
    isFilterable: false,
    sortOrder: 0,
    version: 0,
    inherited: false,
    ...overrides,
  }
}

describe('the category picker’s choices', () => {
  it('are depth first, each carrying the names above it', () => {
    expect(categoryChoices(TREE).map((choice) => choice.path.join('/'))).toEqual([
      '여성',
      '여성/아우터',
      '여성/아우터/코트',
      '여성/아우터/재킷',
      '남성',
    ])
  })

  it('keep retired categories, because definitions on them are still live', () => {
    const retired = categoryChoices(TREE).find((choice) => choice.path.at(-1) === '재킷')

    expect(retired?.isActive).toBe(false)
  })

  it('can be found by id, and answer nothing for a category that is gone', () => {
    const choices = categoryChoices(TREE)

    expect(choiceById(choices, 3)?.path).toEqual(['여성', '아우터', '코트'])
    expect(choiceById(choices, 99)).toBeUndefined()
    expect(choiceById(choices, null)).toBeUndefined()
  })

  it('name a category by its own last segment', () => {
    expect(choiceName({ id: 3, path: ['여성', '아우터', '코트'], isActive: true })).toBe('코트')
    expect(choiceName({ id: 0, path: [], isActive: true })).toBe('')
  })
})

describe('a sentence with a hole in it', () => {
  it('is filled from the values given', () => {
    expect(fill('{name} 에서 물려받음', { name: '여성' })).toBe('여성 에서 물려받음')
  })

  it('is left alone when a value is missing, so the bug is visible', () => {
    expect(fill('{name} 에서 물려받음', {})).toBe('{name} 에서 물려받음')
  })
})

/**
 * The one rule this console restates instead of importing.
 *
 * `optionIssues` decides the same three things in `packages/shared`, but its
 * sentences name the enum — `SELECT 속성은 …` — which rule 4 of the error
 * contract keeps off an operator's screen. So the predicates live in
 * `optionProblems` and this table holds the two to the same verdict. Without it,
 * the copy could be right and the rule quietly different.
 */
describe('the option rules agree with the contract’s', () => {
  const LISTS: readonly (readonly string[])[] = [
    [],
    ['하나'],
    ['하나', '둘'],
    ['하나', '하나'],
    ['', '둘'],
  ]

  const cases = attributeTypes.flatMap((type) => LISTS.map((options) => ({ type, options })))

  it.each(cases)('$type with $options.length choice(s)', ({ type, options }) => {
    expect(optionProblems(type, options).length > 0).toBe(optionIssues(type, options).length > 0)
  })

  it('names what is wrong rather than wording it', () => {
    expect(optionProblems('SELECT', [])).toEqual(['required'])
    expect(optionProblems('TEXT', ['하나'])).toEqual(['forbidden'])
    expect(optionProblems('MULTI_SELECT', ['하나', '하나'])).toEqual(['duplicate'])
    expect(optionProblems('SELECT', ['하나', '둘'])).toEqual([])
  })
})

describe('the preview’s rows', () => {
  const list: readonly EffectiveAttribute[] = [
    attribute(1, 'brand', { categoryId: 1, inherited: true, label: '브랜드' }),
    attribute(2, 'neckline', { label: '넥라인', sortOrder: 0 }),
    attribute(3, 'season', { label: '착용 계절', sortOrder: 1 }),
  ]

  it('are the API’s answer, untouched, when nothing is being edited', () => {
    expect(previewAttributes(list, null).map((row) => row.key)).toEqual([
      'brand',
      'neckline',
      'season',
    ])
    expect(previewAttributes(list, null).every((row) => !row.draft)).toBe(true)
  })

  it('take an unsaved definition in at the position its order asks for', () => {
    const draft: AttributeDraft = {
      id: null,
      key: 'lining',
      label: '안감',
      type: 'TEXT',
      options: [],
      isRequired: false,
      sortOrder: 0,
    }

    const rows = previewAttributes(list, draft)

    // Inherited stays in front whatever the draft's order says; among the
    // category's own rows the tie on `sortOrder` breaks on the key.
    expect(rows.map((row) => row.key)).toEqual(['brand', 'lining', 'neckline', 'season'])
    expect(rows.find((row) => row.key === 'lining')?.draft).toBe(true)
  })

  it('replace the row being edited rather than adding a second one', () => {
    const draft: AttributeDraft = {
      id: 2,
      key: 'neckline',
      label: '목선',
      type: 'SELECT',
      options: ['노치드'],
      isRequired: true,
      sortOrder: 0,
    }

    const rows = previewAttributes(list, draft)

    expect(rows).toHaveLength(3)
    expect(rows[1]).toMatchObject({ key: 'neckline', label: '목선', draft: true })
  })

  it('do not let an inherited row be replaced by a draft', () => {
    const draft: AttributeDraft = {
      id: 1,
      key: 'brand',
      label: '바뀐 브랜드',
      type: 'TEXT',
      options: [],
      isRequired: false,
      sortOrder: 9,
    }

    const rows = previewAttributes(list, draft)

    expect(rows).toHaveLength(4)
    expect(rows.find((row) => row.inherited)?.label).toBe('브랜드')
  })
})

describe('the fields a definition list generates', () => {
  it('map each attribute type onto its control', () => {
    const rows = attributeTypes.map((type, index) =>
      attribute(index + 1, `k${String(index)}`, { type, options: type === 'TEXT' ? [] : ['하나'] }),
    )

    expect(attributeFields(previewAttributes(rows, null)).map((field) => field.type)).toEqual([
      'text',
      'number',
      'select',
      'multiselect',
      'boolean',
    ])
  })

  it('order by the position in the list, not by sortOrder', () => {
    // Both definitions are `sortOrder: 0` — one on an ancestor, one here. The
    // form still has to ask the general question first.
    const rows = previewAttributes(
      [attribute(1, 'brand', { categoryId: 1, inherited: true }), attribute(2, 'neckline')],
      null,
    )

    expect(attributeFields(rows).map((field) => field.order)).toEqual([0, 1])
  })

  it('use a choice’s own text as both value and label', () => {
    const rows = previewAttributes(
      [attribute(1, 'fit', { type: 'SELECT', options: ['오버핏'] })],
      null,
    )

    expect(attributeFields(rows)[0]?.options).toEqual([{ value: '오버핏', label: '오버핏' }])
  })

  it('sign the shape, so a relabelled field does not remount the form', () => {
    const before = attributeFields(previewAttributes([attribute(1, 'brand')], null))
    const after = attributeFields(
      previewAttributes([attribute(1, 'brand', { label: '다른 이름' })], null),
    )
    const added = attributeFields(
      previewAttributes([attribute(1, 'brand'), attribute(2, 'fit')], null),
    )

    expect(fieldSignature(after)).toBe(fieldSignature(before))
    expect(fieldSignature(added)).not.toBe(fieldSignature(before))
  })
})

describe('planning a move', () => {
  const list: readonly EffectiveAttribute[] = [
    attribute(1, 'brand', { categoryId: 1, inherited: true }),
    attribute(2, 'a', { sortOrder: 0 }),
    attribute(3, 'b', { sortOrder: 1 }),
    attribute(4, 'c', { sortOrder: 2 }),
  ]

  it('only considers the definitions this category owns', () => {
    expect(ownAttributes(list).map((row) => row.key)).toEqual(['a', 'b', 'c'])
  })

  it('exchanges a row with its neighbour', () => {
    expect(planSwap(list, 3, 'up')).toMatchObject({ moved: { key: 'b' }, displaced: { key: 'a' } })
    expect(planSwap(list, 3, 'down')).toMatchObject({
      moved: { key: 'b' },
      displaced: { key: 'c' },
    })
  })

  it('answers nothing at the ends, for an inherited row and for an unknown id', () => {
    expect(planSwap(list, 2, 'up')).toBeNull()
    expect(planSwap(list, 4, 'down')).toBeNull()
    expect(planSwap(list, 1, 'up')).toBeNull()
    expect(planSwap(list, 99, 'down')).toBeNull()
  })

  it('draws the result by exchanging the two orders, leaving versions alone', () => {
    const plan = planSwap(list, 3, 'up')
    const after = applySwap(list, plan!)

    expect(after.map((row) => row.key)).toEqual(['brand', 'b', 'a', 'c'])
    expect(after.map((row) => row.sortOrder)).toEqual([0, 0, 1, 2])
    expect(after.every((row) => row.version === 0)).toBe(true)
  })

  /**
   * A limitation worth pinning rather than discovering.
   *
   * `sortOrder` is not unique per category — nothing in the schema makes it so,
   * and a caller that set one explicitly could produce a tie. Exchanging two
   * equal orders exchanges nothing, so the row does not move and the fallback to
   * `id` decides. The screen can never create that state itself (it only ever
   * swaps existing values), which is why 4.6 refuses the "assign the same order
   * and let the tie break" design: it would make this the normal case.
   */
  it('moves nothing when the two rows were given the same order', () => {
    const tied: readonly EffectiveAttribute[] = [
      attribute(7, 'x', { sortOrder: 0 }),
      attribute(8, 'y', { sortOrder: 0 }),
    ]
    const plan = planSwap(tied, 8, 'up')

    expect(applySwap(tied, plan!).map((row) => row.key)).toEqual(['x', 'y'])
  })

  it('keeps inherited rows in front of the category’s own', () => {
    const plan = planSwap(list, 2, 'down')
    const after = applySwap(list, plan!)

    expect(after[0]?.inherited).toBe(true)
    expect(after.map((row) => row.key)).toEqual(['brand', 'b', 'a', 'c'])
  })
})
