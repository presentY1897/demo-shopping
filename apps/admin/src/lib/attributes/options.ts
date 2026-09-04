import type { AttributeType } from '@shopping/shared'
import { attributeTypeHasOptions } from '@shopping/shared'

/**
 * What can be wrong with a definition's choice list.
 *
 * The three the API refuses on, named rather than worded. `optionIssues` in
 * `@shopping/shared` decides the same three, but it decides them **in the
 * server's sentences** — `"SELECT 속성은 선택지가 최소 1개 필요합니다."` — and
 * `SELECT` is not a word this console may put in front of an operator
 * (오류 계약 3장 규칙 4).
 *
 * So the predicates are restated here and the wording comes from the catalog.
 * Restating a rule is how two rules drift, which is why
 * `attribute-options.spec.ts` runs a table of inputs through **both** and
 * requires the same verdict. The guarantee is a test, not a comment.
 */
export const OPTION_PROBLEMS = ['required', 'forbidden', 'duplicate'] as const

export type OptionProblem = (typeof OPTION_PROBLEMS)[number]

/**
 * Everything wrong with `options` for a definition of this `type`.
 *
 * Both directions of the type agreement are refused. A `SELECT` with no choices
 * can never validate any value — a required one makes every product in that
 * category unsaveable — and choices on a `BOOLEAN` are a definition whose author
 * meant something else.
 */
export function optionProblems(
  type: AttributeType,
  options: readonly string[],
): readonly OptionProblem[] {
  const problems: OptionProblem[] = []

  if (attributeTypeHasOptions(type)) {
    if (options.length === 0) problems.push('required')
  } else if (options.length > 0) {
    problems.push('forbidden')
  }

  if (new Set(options).size !== options.length) problems.push('duplicate')

  return problems
}
