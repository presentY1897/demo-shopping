import {
  PRODUCT_MAX_OPTION_VALUES,
  PRODUCT_MAX_OPTIONS,
  PRODUCT_MAX_VARIANTS,
} from '@shopping/shared'

/**
 * What the option editor produces and the Variant table consumes, as pure
 * functions (TASK-0114 R2).
 *
 * **Why the screen has a second copy of this.** The rules live in
 * `apps/api/src/catalog/variant-rules.ts`, and nothing in a browser can import
 * an app. The alternative — ask the server what the combinations would be — is
 * exactly what this screen exists to avoid: 「옵션을 바꾸면 어떤 조합이 추가·
 * 비활성화되는지 **저장 전에** 보인다」 is the point of the editor, and a round
 * trip cannot answer a question about a request that has not been sent.
 *
 * So the two copies have to agree, and the way they are kept agreeing is that
 * the numbers are imported (`PRODUCT_MAX_VARIANTS` and friends) and the
 * ordering rule is stated the same way in both: the cartesian product with the
 * **first axis varying slowest**. A screen that expanded in the other order
 * would number its SKUs differently from the rows the server creates.
 *
 * No React, no clock, no network — every branch is reachable from a unit test,
 * which is why this file carries the 분기 100% target (QUALITY-GATES Q5).
 */

/** One axis, as the option editor holds it while it is being typed. */
export interface OptionAxis {
  readonly name: string
  readonly values: readonly string[]
}

/**
 * The unit separator combinations are keyed by.
 *
 * `variant-rules.ts` uses the same character for the same reason: option values
 * are seller-typed text, and one value reading `블랙, 화이트` would otherwise
 * key the same as the two values `블랙` and `화이트`. Nothing a person can type
 * into a form contains this character.
 */
const KEY_SEPARATOR = '\u001F'

/** The key a combination is matched by — the choices, in axis order. */
export function combinationKeyOf(values: readonly string[]): string {
  return values.join(KEY_SEPARATOR)
}

/**
 * How many variants these axes expand to, without building them.
 *
 * Counted rather than expanded because the count is what decides whether to
 * expand at all: three axes of forty values is 64,000 combinations, and a
 * screen that built the array before checking the cap would freeze the tab on
 * the keystroke that added the fortieth value.
 */
export function combinationCount(axes: readonly OptionAxis[]): number {
  return axes.reduce((total, axis) => total * axis.values.length, 1)
}

/**
 * The cartesian product of the axes' values, first axis varying slowest.
 *
 * `[]` in gives `[[]]` out — one combination with no choices, not zero. That is
 * the whole of the optionless product case: the single variant such a product
 * has falls out of the same loop that makes twelve (DECISIONS 3).
 *
 * Answers an empty list past the cap rather than expanding. The caller has
 * already been told by {@link optionIssues}; this is the guard that keeps the
 * refusal from being a frozen tab.
 */
export function expandCombinations(axes: readonly OptionAxis[]): readonly (readonly string[])[] {
  if (combinationCount(axes) > PRODUCT_MAX_VARIANTS) return []

  let combinations: readonly (readonly string[])[] = [[]]

  for (const axis of axes) {
    combinations = combinations.flatMap((prefix) => axis.values.map((value) => [...prefix, value]))
  }

  return combinations
}

/** Why the axes cannot be expanded, in the reader's terms rather than zod's. */
export type OptionIssueCode =
  /** An axis with no name yet. */
  | 'empty_option_name'
  /** Two axes with the same name — 색상 twice. */
  | 'duplicate_option'
  /** An axis with no choices, which produces no combinations at all. */
  | 'empty_option_values'
  /** A blank choice. */
  | 'empty_option_value'
  /** Two choices with the same label on one axis. */
  | 'duplicate_option_value'
  /** More axes than a listing may have. */
  | 'too_many_options'
  /** More choices on one axis than it may offer. */
  | 'too_many_option_values'
  /** The axes expand past `PRODUCT_MAX_VARIANTS`. */
  | 'too_many_variants'

/**
 * One problem, with the position of the input it is about.
 *
 * A position rather than a sentence, because the copy belongs to the message
 * catalogue and because the same position is what the server's own
 * `details[].field` names (`options.1.values.2.value`). Reporting them the same
 * way is what lets one placement rule cover both.
 */
export interface OptionIssue {
  readonly code: OptionIssueCode
  /** Index of the axis, or `null` for a problem about the set of axes. */
  readonly optionIndex: number | null
  /** Index of the choice, or `null` for a problem about the axis itself. */
  readonly valueIndex: number | null
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

/**
 * Everything wrong with the axes, collected rather than reported one at a time.
 *
 * A seller filling in twelve choices should see all of their typos at once, not
 * the first one twelve times. The kinds are still ordered — the set of axes,
 * then each axis, then the expansion — because a combination count computed
 * from contradictory axes says nothing.
 *
 * A blank name or a blank choice is an issue here and is **not** sent to the
 * server: the request schema would refuse it as a 400 whose `details` name a
 * path the seller cannot see. Catching it in the editor is what turns that into
 * a message under the box they are typing in.
 */
export function optionIssues(axes: readonly OptionAxis[]): readonly OptionIssue[] {
  const issues: OptionIssue[] = []

  if (axes.length > PRODUCT_MAX_OPTIONS) {
    issues.push({ code: 'too_many_options', optionIndex: null, valueIndex: null })
  }

  axes.forEach((axis, optionIndex) => {
    if (axis.name.trim() === '') {
      issues.push({ code: 'empty_option_name', optionIndex, valueIndex: null })
    }
    if (axis.values.length === 0) {
      issues.push({ code: 'empty_option_values', optionIndex, valueIndex: null })
    }
    if (axis.values.length > PRODUCT_MAX_OPTION_VALUES) {
      issues.push({ code: 'too_many_option_values', optionIndex, valueIndex: null })
    }

    axis.values.forEach((value, valueIndex) => {
      if (value.trim() === '') {
        issues.push({ code: 'empty_option_value', optionIndex, valueIndex })
      }
    })

    for (const valueIndex of duplicateIndexes(axis.values)) {
      issues.push({ code: 'duplicate_option_value', optionIndex, valueIndex })
    }
  })

  for (const optionIndex of duplicateIndexes(axes.map((axis) => axis.name))) {
    issues.push({ code: 'duplicate_option', optionIndex, valueIndex: null })
  }

  if (combinationCount(axes) > PRODUCT_MAX_VARIANTS) {
    issues.push({ code: 'too_many_variants', optionIndex: null, valueIndex: null })
  }

  return issues
}

/** One combination that already exists on the stored listing. */
export interface StoredCombination {
  readonly variantId: string
  /** The choices, in axis order — read back from the stored option values. */
  readonly values: readonly string[]
  readonly isActive: boolean
}

/**
 * What saving these axes would do to the listing's variants.
 *
 * The three buckets are the three things a seller is about to cause, and each
 * one has a different consequence:
 *
 * - `added` — combinations with no row yet. They will be **created**, starting
 *   from the bulk defaults, so the seller has to have set a price.
 * - `deactivated` — rows the axes no longer produce. They are **switched off,
 *   not deleted**: an order placed yesterday points at that row (TASK-0113
 *   F5b), so their stock and their history survive.
 * - `kept` — everything else, whose stock is untouched by the save. This is the
 *   bucket the seller most needs to be sure about, because 「사이즈를 하나
 *   더했더니 재고가 전부 0이 됐다」 is the failure they are afraid of.
 *
 * Matched by **value**, in axis order — `['블랙', 'M']`. Matching as an
 * unordered set would look friendlier right up to the product whose 색상 and
 * 사이즈 both offer `F`, where it would silently pair the wrong two.
 */
export interface VariantDiff {
  readonly added: readonly (readonly string[])[]
  readonly deactivated: readonly StoredCombination[]
  readonly kept: readonly StoredCombination[]
}

export function variantDiff(
  stored: readonly StoredCombination[],
  planned: readonly (readonly string[])[],
): VariantDiff {
  const live = new Map(stored.map((entry) => [combinationKeyOf(entry.values), entry] as const))
  const wanted = new Set(planned.map((combination) => combinationKeyOf(combination)))

  return {
    added: planned.filter((combination) => !live.has(combinationKeyOf(combination))),
    deactivated: stored.filter((entry) => !wanted.has(combinationKeyOf(entry.values))),
    kept: stored.filter((entry) => wanted.has(combinationKeyOf(entry.values))),
  }
}

/** True when nothing about the listing's combinations would change. */
export function isUnchanged(diff: VariantDiff): boolean {
  return diff.added.length === 0 && diff.deactivated.length === 0
}
