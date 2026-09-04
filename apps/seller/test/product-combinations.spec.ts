/**
 * The combination rules the editor decides with, branch by branch
 * (QUALITY-GATES Q5 — 순수 로직 분기 100%).
 *
 * These are a **second copy** of `apps/api/src/catalog/variant-rules.ts`: a
 * browser cannot import an app, and the screen has to answer 「이 옵션을
 * 더하면 조합이 몇 개가 되는가」 before a request exists to ask the server
 * about. So the two have to agree, and what keeps them agreeing is that the
 * caps are imported and the expansion order is asserted here in the same words
 * the server's own spec uses — first axis varying slowest.
 */

import {
  PRODUCT_MAX_OPTION_VALUES,
  PRODUCT_MAX_OPTIONS,
  PRODUCT_MAX_VARIANTS,
} from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import type { OptionAxis, OptionIssueCode, StoredCombination } from '@/lib/products/combinations'
import {
  combinationCount,
  combinationKeyOf,
  expandCombinations,
  isUnchanged,
  optionIssues,
  variantDiff,
} from '@/lib/products/combinations'

function axis(name: string, ...values: readonly string[]): OptionAxis {
  return { name, values }
}

function codes(axes: readonly OptionAxis[]): readonly OptionIssueCode[] {
  return optionIssues(axes).map((issue) => issue.code)
}

describe('counting combinations', () => {
  it('is one for a product with no options', () => {
    // Not zero: a product with no axes still has the one variant that carries
    // its price and its SKU (DECISIONS 3).
    expect(combinationCount([])).toBe(1)
  })

  it('is the product of the axes', () => {
    expect(
      combinationCount([axis('색상', '블랙', '흰색', '카멜'), axis('사이즈', 'S', 'M', 'L', 'XL')]),
    ).toBe(12)
  })

  it('is zero when an axis has no choices yet', () => {
    expect(combinationCount([axis('색상')])).toBe(0)
  })
})

describe('expanding combinations', () => {
  it('gives one empty combination for no axes', () => {
    expect(expandCombinations([])).toEqual([[]])
  })

  it('varies the first axis slowest', () => {
    expect(expandCombinations([axis('색상', '블랙', '흰색'), axis('사이즈', 'S', 'M')])).toEqual([
      ['블랙', 'S'],
      ['블랙', 'M'],
      ['흰색', 'S'],
      ['흰색', 'M'],
    ])
  })

  it('refuses to build a list past the cap, rather than freezing the tab', () => {
    const wide = [
      axis('a', ...Array.from({ length: 40 }, (_unused, i) => `a${String(i)}`)),
      axis('b', ...Array.from({ length: 40 }, (_unused, i) => `b${String(i)}`)),
    ]

    expect(combinationCount(wide)).toBeGreaterThan(PRODUCT_MAX_VARIANTS)
    expect(expandCombinations(wide)).toEqual([])
  })

  it('builds exactly the cap', () => {
    const atCap = [
      axis('a', ...Array.from({ length: 20 }, (_unused, i) => `a${String(i)}`)),
      axis('b', ...Array.from({ length: 10 }, (_unused, i) => `b${String(i)}`)),
    ]

    // Both sides of the boundary. A guard that read the constant one off would
    // pass a test that only pushed past it.
    expect(expandCombinations(atCap)).toHaveLength(PRODUCT_MAX_VARIANTS)
  })
})

describe('keying a combination', () => {
  it('does not confuse one value holding a comma with two values', () => {
    expect(combinationKeyOf(['블랙, 화이트'])).not.toBe(combinationKeyOf(['블랙', '화이트']))
  })
})

describe('what is wrong with the axes', () => {
  it('says nothing about axes that are fine', () => {
    expect(codes([axis('색상', '블랙', '흰색')])).toEqual([])
  })

  it('finds an unnamed axis', () => {
    expect(codes([axis('   ', '블랙')])).toEqual(['empty_option_name'])
  })

  it('finds an axis with no choices', () => {
    expect(codes([axis('색상')])).toEqual(['empty_option_values'])
  })

  it('finds a blank choice, and says which one', () => {
    const issues = optionIssues([axis('색상', '블랙', '  ')])

    expect(issues).toEqual([{ code: 'empty_option_value', optionIndex: 0, valueIndex: 1 }])
  })

  it('finds a repeated choice, and says which one', () => {
    const issues = optionIssues([axis('색상', '블랙', '블랙')])

    expect(issues).toEqual([{ code: 'duplicate_option_value', optionIndex: 0, valueIndex: 1 }])
  })

  it('finds two axes with the same name', () => {
    expect(codes([axis('색상', '블랙'), axis('색상', '흰색')])).toContain('duplicate_option')
  })

  it('finds more axes than a listing may have', () => {
    const axes = Array.from({ length: PRODUCT_MAX_OPTIONS + 1 }, (_unused, index) =>
      axis(`옵션${String(index)}`, 'x'),
    )

    expect(codes(axes)).toContain('too_many_options')
  })

  it('finds more choices than one axis may offer', () => {
    const values = Array.from({ length: PRODUCT_MAX_OPTION_VALUES + 1 }, (_u, i) => `v${String(i)}`)

    expect(codes([axis('색상', ...values)])).toContain('too_many_option_values')
  })

  it('finds too many combinations before anything is expanded', () => {
    const axes = [
      axis('a', ...Array.from({ length: 21 }, (_unused, i) => `a${String(i)}`)),
      axis('b', ...Array.from({ length: 10 }, (_unused, i) => `b${String(i)}`)),
    ]

    expect(codes(axes)).toContain('too_many_variants')
  })

  it('collects every typo at once rather than the first one repeatedly', () => {
    // A seller filling in twelve choices should see all of their mistakes in
    // one pass, which is what makes the panel worth reading.
    expect(codes([axis('', '블랙', '블랙', ' ')])).toEqual([
      'empty_option_name',
      'empty_option_value',
      'duplicate_option_value',
    ])
  })
})

describe('what saving would do to the variants', () => {
  const stored: readonly StoredCombination[] = [
    { variantId: 'v1', values: ['블랙', 'S'], isActive: true },
    { variantId: 'v2', values: ['블랙', 'M'], isActive: true },
    { variantId: 'v3', values: ['흰색', 'S'], isActive: false },
  ]

  it('finds nothing to do when the axes are unchanged', () => {
    const diff = variantDiff(stored, [
      ['블랙', 'S'],
      ['블랙', 'M'],
      ['흰색', 'S'],
    ])

    expect(isUnchanged(diff)).toBe(true)
    expect(diff.kept).toHaveLength(3)
  })

  it('lists the combinations a new choice brings into existence', () => {
    const diff = variantDiff(stored, [
      ['블랙', 'S'],
      ['블랙', 'M'],
      ['블랙', 'L'],
      ['흰색', 'S'],
    ])

    expect(diff.added).toEqual([['블랙', 'L']])
    expect(diff.deactivated).toEqual([])
    expect(isUnchanged(diff)).toBe(false)
  })

  it('lists the rows a removed choice orphans, and keeps them as rows', () => {
    const diff = variantDiff(stored, [['블랙', 'S']])

    // Switched off, not deleted: an order placed yesterday points at that row
    // (TASK-0113 F5b). So the seller is told how many stop being sellable, not
    // how many disappear.
    expect(diff.deactivated.map((entry) => entry.variantId)).toEqual(['v2', 'v3'])
    expect(diff.kept.map((entry) => entry.variantId)).toEqual(['v1'])
  })

  it('counts a row whose combination came back as kept, not as added', () => {
    // The seller removed `M` and put it back before saving. Nothing has been
    // sent, so the stored row is still there and its stock is still its own.
    const diff = variantDiff(stored, [
      ['블랙', 'S'],
      ['블랙', 'M'],
      ['흰색', 'S'],
    ])

    expect(diff.added).toEqual([])
    expect(diff.kept.map((entry) => entry.variantId)).toEqual(['v1', 'v2', 'v3'])
  })

  it('matches by order, not as a set', () => {
    // 색상 `F` and 사이즈 `F` on one product: a set-based match would pair the
    // wrong two and silently move a price from one variant to another.
    const ambiguous: readonly StoredCombination[] = [
      { variantId: 'v1', values: ['F', 'M'], isActive: true },
    ]
    const diff = variantDiff(ambiguous, [['M', 'F']])

    expect(diff.added).toEqual([['M', 'F']])
    expect(diff.deactivated.map((entry) => entry.variantId)).toEqual(['v1'])
  })
})
