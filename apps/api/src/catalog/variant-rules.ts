/**
 * The rules of a variant, as pure functions.
 *
 * Two questions live here and neither of them needs a database.
 *
 * **Which variants does a product have?** The answer is the cartesian product
 * of its axes — 색상 3 × 사이즈 4 is twelve — plus the overrides the caller
 * named for individual combinations. Getting it wrong is not a crash: it is a
 * listing whose option grid offers a combination that has no row, or a row no
 * combination reaches, and both look fine until somebody tries to buy.
 *
 * **How many of one variant may an order contain?** `null` on the variant means
 * "inherit the product's" (TASK-0032 4.1), and this file is the only place that
 * says so. Four different call sites have to enforce that cap — basket,
 * checkout, reservation, order creation (TASK-0045 · 0050 · 0048 · 0049) — and
 * four independent `variant.max ?? product.max` expressions is exactly how the
 * fourth one ends up with the precedence backwards.
 *
 * No I/O, so every branch is reachable from a unit test and the gate on this
 * file is branch coverage 100% (QUALITY-GATES Q5 — 순수 로직).
 */

/** One axis of a product, as the request states it. */
export interface AxisInput {
  readonly name: string
  readonly values: readonly string[]
}

/** Anything that names a combination by value, in axis order. */
export interface CombinationOverride {
  readonly optionValues: readonly string[]
}

export type PlanIssueCode =
  /** Two axes with the same name — 색상 twice. */
  | 'duplicate_option'
  /** Two choices with the same label on one axis. */
  | 'duplicate_option_value'
  /** The axes expand to more variants than a listing may hold. */
  | 'too_many_variants'
  /** An override names a different number of values than there are axes. */
  | 'combination_arity'
  /** An override names a combination the axes do not produce. */
  | 'unknown_combination'
  /** Two overrides for one combination. */
  | 'duplicate_combination'

/**
 * One refusal, with the path of the input it is about.
 *
 * A path rather than a sentence, because the caller turns it into a
 * `details[].field` — `options.1.values.2`, `variants.3.optionValues` — and the
 * form on the other side places the message under the control the person
 * actually touched (`docs/design/error-contract.md` 1).
 */
export interface PlanIssue {
  readonly code: PlanIssueCode
  readonly path: readonly (string | number)[]
}

/** One variant to create, and the override that customises it, if any. */
export interface VariantPlan<TOverride> {
  /** The choices, one per axis, in axis order. Empty for a product with no options. */
  readonly combination: readonly string[]
  readonly override: TOverride | undefined
}

export type VariantPlanResult<TOverride> =
  | { readonly ok: true; readonly plans: readonly VariantPlan<TOverride>[] }
  | { readonly ok: false; readonly issues: readonly PlanIssue[] }

/**
 * Separator for the internal key a combination is matched by.
 *
 * A unit separator (`U+001F`) rather than a comma or a slash: option values are
 * operator-typed text, and one value reading `블랙, 화이트` would otherwise key
 * the same as the two values `블랙` and `화이트`. Nothing a person can type into
 * a form contains this character.
 */
const KEY_SEPARATOR = '\u001F'

/** The key a combination is matched by — the choices, in axis order. */
export function combinationKeyOf(values: readonly string[]): string {
  return values.join(KEY_SEPARATOR)
}

/**
 * The separator between option value ids in `ProductVariant.optionSignature`.
 *
 * A slash, and safe to be one: the ids are UUIDs, so no id can contain it.
 */
export const OPTION_SIGNATURE_SEPARATOR = '/'

/**
 * The canonical signature of a combination — the option value ids, sorted, joined.
 *
 * Sorted so that the signature is a property of the **set** of choices rather
 * than of the order they arrived in: `ProductVariant_product_signature_key` is
 * a unique index on this string, and two rows differing only in the order their
 * ids were listed would be two variants of one combination — the exact
 * corruption that index exists to prevent.
 *
 * A product with no options signs as the empty string, which is a value like
 * any other and is therefore covered by that same index. That is what makes
 * "옵션 없는 상품도 Variant 1개" (DECISIONS 3) an index rather than a rule
 * somebody has to remember.
 */
export function optionSignatureOf(optionValueIds: readonly string[]): string {
  return [...optionValueIds].sort().join(OPTION_SIGNATURE_SEPARATOR)
}

/**
 * The cartesian product of the axes' values, first axis varying slowest.
 *
 * `[]` in gives `[[]]` out — one combination with no choices, not zero
 * combinations. That is the whole of the optionless-product case: the caller
 * needs no branch for it, and the single variant such a product gets falls out
 * of the same loop that makes twelve.
 */
export function expandCombinations(axes: readonly AxisInput[]): readonly (readonly string[])[] {
  let combinations: readonly (readonly string[])[] = [[]]

  for (const axis of axes) {
    combinations = combinations.flatMap((prefix) => axis.values.map((value) => [...prefix, value]))
  }

  return combinations
}

/** Positions of the entries that repeat an earlier one. */
function duplicateIndexes(values: readonly string[]): readonly number[] {
  const seen = new Set<string>()
  const repeats: number[] = []

  values.forEach((value, index) => {
    if (seen.has(value)) repeats.push(index)
    else seen.add(value)
  })

  return repeats
}

/** Refusals about the axes themselves, before anything is expanded. */
function axisIssues(axes: readonly AxisInput[]): readonly PlanIssue[] {
  const issues: PlanIssue[] = []

  for (const index of duplicateIndexes(axes.map((axis) => axis.name))) {
    issues.push({ code: 'duplicate_option', path: ['options', index, 'name'] })
  }

  axes.forEach((axis, axisIndex) => {
    for (const index of duplicateIndexes(axis.values)) {
      issues.push({
        code: 'duplicate_option_value',
        path: ['options', axisIndex, 'values', index, 'value'],
      })
    }
  })

  return issues
}

/**
 * Matches each override to the combination it names.
 *
 * Order matters: `['블랙', 'M']` is the combination on a product whose axes are
 * 색상 then 사이즈, and `['M', '블랙']` is not. Matching as an unordered set
 * would look friendlier right up to the product whose 색상 and 사이즈 both
 * offer `F`, where it would silently pick one of two different variants.
 */
function matchOverrides<TOverride extends CombinationOverride>(
  axisCount: number,
  known: ReadonlySet<string>,
  overrides: readonly TOverride[],
): { readonly matched: ReadonlyMap<string, TOverride>; readonly issues: readonly PlanIssue[] } {
  const matched = new Map<string, TOverride>()
  const issues: PlanIssue[] = []

  overrides.forEach((override, index) => {
    const path = ['variants', index, 'optionValues']

    if (override.optionValues.length !== axisCount) {
      issues.push({ code: 'combination_arity', path })
      return
    }

    const key = combinationKeyOf(override.optionValues)

    if (!known.has(key)) {
      issues.push({ code: 'unknown_combination', path })
      return
    }
    if (matched.has(key)) {
      issues.push({ code: 'duplicate_combination', path })
      return
    }

    matched.set(key, override)
  })

  return { matched, issues }
}

/**
 * Every variant a product should have, in creation order.
 *
 * The combinations come from the axes and the overrides are laid over them —
 * never the other way round. A listing sells its whole grid unless a variant is
 * switched off, so "일부 조합만 판매" is `isActive: false` on the combination
 * rather than its absence from the request (TASK-0032 4장). An override for a
 * combination the axes do not produce is therefore a mistake worth reporting,
 * not an extra variant to create.
 *
 * Issues of one kind are collected before returning: a caller filling in twelve
 * combinations should see all of their typos at once, not the first one twelve
 * times. The kinds are still ordered — axes first, then the expansion, then the
 * overrides — because an override cannot be judged against axes that are
 * themselves contradictory.
 */
export function planVariants<TOverride extends CombinationOverride>(
  axes: readonly AxisInput[],
  overrides: readonly TOverride[],
  maxVariants: number,
): VariantPlanResult<TOverride> {
  const issues = axisIssues(axes)

  if (issues.length > 0) return { ok: false, issues }

  const combinations = expandCombinations(axes)

  if (combinations.length > maxVariants) {
    return { ok: false, issues: [{ code: 'too_many_variants', path: ['options'] }] }
  }

  const known = new Set(combinations.map((combination) => combinationKeyOf(combination)))
  const { matched, issues: overrideIssues } = matchOverrides(axes.length, known, overrides)

  if (overrideIssues.length > 0) return { ok: false, issues: overrideIssues }

  return {
    ok: true,
    plans: combinations.map((combination) => ({
      combination,
      override: matched.get(combinationKeyOf(combination)),
    })),
  }
}

/**
 * The cap that actually applies to one variant (TASK-0032 4.1).
 *
 * The variant's own value wins when it has one, **including when the product
 * has none** — a seller who caps one limited colourway on an otherwise
 * unlimited product means exactly that. `null` from both is no cap at all.
 *
 * Written once and exported so that the four places that enforce it
 * (TASK-0045 · 0050 · 0048 · 0049) share one answer. A cap enforced three ways
 * out of four is not a cap.
 */
export function resolvePurchaseLimit(
  productLimit: number | null,
  variantLimit: number | null,
): number | null {
  return variantLimit ?? productLimit
}
