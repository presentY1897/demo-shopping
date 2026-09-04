import { describe, expect, it } from 'vitest'

import type { AxisInput, PlanIssue } from './variant-rules.js'
import {
  combinationKeyOf,
  expandCombinations,
  optionSignatureOf,
  planVariants,
  resolvePurchaseLimit,
} from './variant-rules.js'

/**
 * Input → output, no database (QUALITY-GATES Q5 — 순수 로직, 분기 100%).
 *
 * The two things decided here are invisible when they go wrong. A combination
 * that is generated twice becomes two rows answering the same buyer selection,
 * and the storefront shows whichever the planner returned first — a price that
 * changes on refresh. A purchase cap resolved with the precedence backwards
 * lets a limited colourway be bought in bulk while every screen still displays
 * the limit it was supposed to enforce.
 */

const COLOUR: AxisInput = { name: '색상', values: ['블랙', '화이트', '그레이'] }
const SIZE: AxisInput = { name: '사이즈', values: ['S', 'M', 'L', 'XL'] }

/** The plan's issue codes, in the order they were reported. */
function codesOf(issues: readonly PlanIssue[]): readonly string[] {
  return issues.map((issue) => issue.code)
}

function issuesOf(axes: readonly AxisInput[], overrides: readonly { optionValues: string[] }[]) {
  const result = planVariants(axes, overrides, 200)

  if (result.ok) throw new Error('거부될 것으로 기대했지만 통과했습니다.')
  return result.issues
}

function plansOf(axes: readonly AxisInput[], overrides: readonly { optionValues: string[] }[]) {
  const result = planVariants(axes, overrides, 200)

  if (!result.ok) throw new Error(`통과할 것으로 기대했습니다: ${JSON.stringify(result.issues)}`)
  return result.plans
}

describe('expandCombinations', () => {
  it('makes twelve out of three colours and four sizes', () => {
    // 완료 기준 F1, as the requirement words it.
    expect(expandCombinations([COLOUR, SIZE])).toHaveLength(12)
  })

  it('varies the first axis slowest', () => {
    // Not cosmetic: the generated SKUs are numbered in this order, so the
    // sequence is what a seller reads down their variant table.
    expect(expandCombinations([COLOUR, SIZE]).slice(0, 5)).toEqual([
      ['블랙', 'S'],
      ['블랙', 'M'],
      ['블랙', 'L'],
      ['블랙', 'XL'],
      ['화이트', 'S'],
    ])
  })

  it('answers one empty combination when there are no axes', () => {
    // The whole of the optionless-product case (완료 기준 F2). Not zero
    // combinations — that would leave the product with no variant, and every
    // reader downstream with a branch for a product that cannot be priced.
    expect(expandCombinations([])).toEqual([[]])
  })

  it('answers one combination per value for a single axis', () => {
    expect(expandCombinations([COLOUR])).toEqual([['블랙'], ['화이트'], ['그레이']])
  })
})

describe('optionSignatureOf', () => {
  it('does not depend on the order the ids arrived in', () => {
    // The signature is a unique index. Two rows differing only in the order
    // their ids were listed would be two variants of one combination, which is
    // the corruption `ProductVariant_product_signature_key` exists to prevent.
    expect(optionSignatureOf(['b', 'a', 'c'])).toBe(optionSignatureOf(['c', 'b', 'a']))
  })

  it('joins the ids with a slash', () => {
    expect(optionSignatureOf(['a', 'b'])).toBe('a/b')
  })

  it('signs a combination with no choices as the empty string', () => {
    // Which the partial unique index treats as a value like any other, so
    // "옵션 없는 상품의 살아있는 Variant 는 1개" is enforced by the index.
    expect(optionSignatureOf([])).toBe('')
  })
})

describe('combinationKeyOf', () => {
  it('separates values with a character no operator can type', () => {
    // One value reading `블랙, 화이트` must not key the same as the two values
    // `블랙` and `화이트`.
    expect(combinationKeyOf(['블랙, 화이트'])).not.toBe(combinationKeyOf(['블랙', '화이트']))
  })
})

describe('planVariants', () => {
  it('plans every combination, with no override by default', () => {
    const plans = plansOf([COLOUR, SIZE], [])

    expect(plans).toHaveLength(12)
    expect(plans.every((plan) => plan.override === undefined)).toBe(true)
  })

  it('lays an override onto the combination it names', () => {
    const override = { optionValues: ['화이트', 'M'] }
    const plans = plansOf([COLOUR, SIZE], [override])

    // Overrides customise combinations, they do not select them: the other
    // eleven are still planned (TASK-0032 4장 — 부분 판매는 비활성화로).
    expect(plans).toHaveLength(12)
    expect(plans.find((plan) => plan.override !== undefined)?.combination).toEqual(['화이트', 'M'])
  })

  it('plans one variant for a product with no options', () => {
    expect(plansOf([], [{ optionValues: [] }])).toEqual([
      { combination: [], override: { optionValues: [] } },
    ])
  })

  it('refuses two axes with the same name', () => {
    const issues = issuesOf([COLOUR, { name: '색상', values: ['레드'] }], [])

    expect(codesOf(issues)).toEqual(['duplicate_option'])
    expect(issues[0]?.path).toEqual(['options', 1, 'name'])
  })

  it('refuses a repeated choice on one axis and names its position', () => {
    // The database refuses it too (`ProductOptionValue_option_value_key`), but
    // as a 409 naming a constraint. Catching it here is what lets the form put
    // the message under the second 블랙.
    const issues = issuesOf([{ name: '색상', values: ['블랙', '블랙'] }], [])

    expect(codesOf(issues)).toEqual(['duplicate_option_value'])
    expect(issues[0]?.path).toEqual(['options', 0, 'values', 1, 'value'])
  })

  it('reports every axis problem at once', () => {
    const issues = issuesOf(
      [
        { name: '색상', values: ['블랙', '블랙'] },
        { name: '색상', values: ['S', 'S'] },
      ],
      [],
    )

    // A person fixing a twelve-row form should see all of their typos, not the
    // first one twelve times.
    expect(codesOf(issues)).toEqual([
      'duplicate_option',
      'duplicate_option_value',
      'duplicate_option_value',
    ])
  })

  it('refuses an expansion larger than the cap', () => {
    // Three axes of forty choices is sixty-four thousand variants: a mistake
    // that takes a minute to write and an afternoon to undo.
    const result = planVariants([COLOUR, SIZE], [], 11)

    expect(result.ok).toBe(false)
    expect(result.ok ? [] : codesOf(result.issues)).toEqual(['too_many_variants'])
  })

  it('accepts an expansion exactly at the cap', () => {
    // The boundary is inclusive: twelve variants with a cap of twelve is a
    // listing somebody meant to create.
    expect(planVariants([COLOUR, SIZE], [], 12).ok).toBe(true)
  })

  it('refuses an override that names the wrong number of choices', () => {
    const issues = issuesOf([COLOUR, SIZE], [{ optionValues: ['블랙'] }])

    expect(codesOf(issues)).toEqual(['combination_arity'])
    expect(issues[0]?.path).toEqual(['variants', 0, 'optionValues'])
  })

  it('refuses an override for a combination the axes do not produce', () => {
    // A typo — `블랙2` — would otherwise be silently ignored, and the seller
    // would find the price they set missing with no error anywhere.
    expect(codesOf(issuesOf([COLOUR, SIZE], [{ optionValues: ['블랙2', 'M'] }]))).toEqual([
      'unknown_combination',
    ])
  })

  it('refuses an override whose choices are in the wrong axis order', () => {
    // Order is the matching rule (see `matchOverrides`): treating the values as
    // an unordered set would silently pick one of two variants on a product
    // whose 색상 and 사이즈 both offer `F`.
    expect(codesOf(issuesOf([COLOUR, SIZE], [{ optionValues: ['M', '블랙'] }]))).toEqual([
      'unknown_combination',
    ])
  })

  it('refuses two overrides for one combination', () => {
    const issues = issuesOf(
      [COLOUR, SIZE],
      [{ optionValues: ['블랙', 'S'] }, { optionValues: ['블랙', 'S'] }],
    )

    expect(codesOf(issues)).toEqual(['duplicate_combination'])
    expect(issues[0]?.path).toEqual(['variants', 1, 'optionValues'])
  })

  it('reports every override problem at once', () => {
    expect(
      codesOf(
        issuesOf(
          [COLOUR, SIZE],
          [
            { optionValues: ['블랙'] },
            { optionValues: ['없는색', 'S'] },
            { optionValues: ['블랙', 'S'] },
            { optionValues: ['블랙', 'S'] },
          ],
        ),
      ),
    ).toEqual(['combination_arity', 'unknown_combination', 'duplicate_combination'])
  })

  it('does not judge overrides against axes that contradict themselves', () => {
    // With a duplicated choice there are two answers to "which combinations
    // exist", so an `unknown_combination` reported here would be noise the
    // person cannot act on until the axis is fixed.
    expect(
      codesOf(
        issuesOf([{ name: '색상', values: ['블랙', '블랙'] }], [{ optionValues: ['없는색'] }]),
      ),
    ).toEqual(['duplicate_option_value'])
  })
})

describe('resolvePurchaseLimit', () => {
  it("takes the product's cap when the variant has none", () => {
    expect(resolvePurchaseLimit(2, null)).toBe(2)
  })

  it("lets the variant's cap win", () => {
    expect(resolvePurchaseLimit(5, 1)).toBe(1)
  })

  it("lets the variant's cap win even when it is looser", () => {
    // Not `min`: a seller who raises the cap on one variant means it.
    expect(resolvePurchaseLimit(1, 5)).toBe(5)
  })

  it('caps a variant of an otherwise uncapped product', () => {
    expect(resolvePurchaseLimit(null, 1)).toBe(1)
  })

  it('answers no cap when neither has one', () => {
    expect(resolvePurchaseLimit(null, null)).toBeNull()
  })
})
