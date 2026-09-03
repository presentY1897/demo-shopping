import type { AttributeDefinition, AttributeType, AttributeValues } from '@shopping/shared'
import { ATTRIBUTE_TEXT_MAX_LENGTH } from '@shopping/shared'
import { z } from 'zod'

/**
 * Turning attribute **definitions** into the schema that judges attribute
 * **values** — as pure functions.
 *
 * This file is the whole reason TASK-0030 exists. The catalogue stores values in
 * `Product.attributes`, a JSONB column, so that listing twenty products costs no
 * joins (`docs/design/erd.md` 2). The price of that is stated in the same place:
 * **the database cannot check a single value.** A column of type `jsonb` accepts
 * `{"weight": "무거움"}` as readily as `{"weight": 1200}`, and it accepts
 * `{"colour": "블랙"}` for a definition whose key is `color`.
 *
 * So this is the only defence, and it has two properties it must not lose.
 *
 * **It is derived, never written twice.** The schema comes from the rows an
 * operator created minutes ago. Nothing here knows what `material` is; adding a
 * definition changes what is accepted on the next call with no deploy in
 * between, which is what D-005 — "코드 수정 없이 카테고리와 속성을 추가할 수
 * 있어야 한다" — actually means in code.
 *
 * **It has no I/O.** Definitions come in as values and a verdict comes out, so
 * every branch is reachable from a unit test and the gate on this file is
 * branch coverage 100% (QUALITY-GATES Q5 — 순수 로직). A branch nothing reaches
 * is a value nothing refuses, and the symptom of getting one wrong is not a
 * failing test: it is a product row that no screen can render.
 */

/**
 * The part of a definition that decides whether a value is acceptable.
 *
 * A structural subset rather than the whole row, so that a caller holding
 * anything definition-shaped — an API response, a database row, a fixture —
 * can ask, and so that adding a display-only column to the table cannot change
 * what this file does.
 */
export type AttributeRule = Pick<
  AttributeDefinition,
  'key' | 'label' | 'type' | 'options' | 'isRequired'
>

/** Why one attribute was refused. `key` is `''` for a refusal about the whole object. */
export interface AttributeIssue {
  readonly key: string
  readonly message: string
}

export type AttributeValidation =
  | { readonly ok: true; readonly values: AttributeValues }
  | { readonly ok: false; readonly issues: readonly AttributeIssue[] }

/** The key an issue carries when it is about the object rather than a field. */
export const ROOT_ATTRIBUTE_KEY = ''

/**
 * "Nothing was given", in the four shapes a browser sends it.
 *
 * A form that submits an untouched field sends `''`; a multi-select with no
 * boxes ticked sends `[]`; a JSON client that means "clear this" sends `null`.
 * All three mean the same thing as leaving the key out, and treating them as
 * values instead would make a required attribute satisfiable with an empty
 * string and would store `{"colors": []}` as though the operator had chosen
 * something.
 *
 * Normalising **before** the schema runs is what lets a required attribute
 * report "값이 없습니다" for all four, rather than a type error for three of
 * them and a missing-key error for the fourth.
 */
export function isAbsent(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (value === '') return true

  return Array.isArray(value) && value.length === 0
}

/** A plain object, which is the only thing an attribute bag can be. */
function isValueBag(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Drops the keys that carry nothing, so absence has exactly one meaning. */
function stripAbsent(input: unknown): unknown {
  if (!isValueBag(input)) return input

  return Object.fromEntries(Object.entries(input).filter(([, value]) => !isAbsent(value)))
}

/**
 * The message one rule produces, for a value that is missing and for one that
 * is wrong.
 *
 * Both cases arrive at zod as the same kind of issue, distinguished only by
 * whether the input was `undefined` — which, after {@link stripAbsent}, is
 * exactly "the operator left it blank". Naming the label *and* the key is
 * deliberate: the label is what the person filling the form recognises, and the
 * key is what a developer reading a log needs (완료 기준 F2 — 필드명 포함).
 */
function messageFor(
  rule: AttributeRule,
  expectation: string,
): (issue: { input: unknown }) => string {
  return (issue) =>
    issue.input === undefined
      ? `필수 속성 '${rule.label}'(${rule.key}) 값이 없습니다.`
      : `'${rule.label}'(${rule.key}) ${expectation}`
}

/** Renders the choices for a message, without letting one run to a page. */
function optionList(options: readonly string[]): string {
  const shown = options.slice(0, 10).join(', ')

  return options.length > 10 ? `${shown} 외 ${String(options.length - 10)}개` : shown
}

/**
 * One schema per type, as a lookup rather than a `switch`.
 *
 * A table cannot fall through to a default that nobody wrote and nobody tests:
 * `Record<AttributeType, …>` is total, so adding a type to
 * `@shopping/shared`'s list without adding it here stops compiling. A `switch`
 * would need an unreachable default branch, which coverage would then demand a
 * test for that cannot exist.
 */
const VALUE_SCHEMAS: Readonly<Record<AttributeType, (rule: AttributeRule) => z.ZodType>> = {
  /** Trimmed, because trailing whitespace in a facet value is a separate value. */
  TEXT: (rule) =>
    z
      .string({ error: messageFor(rule, '값은 문자열이어야 합니다.') })
      .trim()
      .max(ATTRIBUTE_TEXT_MAX_LENGTH, {
        error: `'${rule.label}'(${rule.key}) 값은 ${String(ATTRIBUTE_TEXT_MAX_LENGTH)}자 이하여야 합니다.`,
      }),

  /**
   * A finite number, and nothing that merely looks like one.
   *
   * Strings are refused outright rather than coerced: `Number('12kg')` is `NaN`
   * and `Number('')` is `0`, so coercion turns two different mistakes into one
   * plausible-looking value. `NaN` and `Infinity` are refused by
   * `z.number()` itself in zod 4 — worth knowing, because both survive
   * `typeof value === 'number'` and both come back from a JSONB round trip as
   * `null`, which would silently empty a required attribute. An explicit
   * `.finite()` on top would be a branch no input can reach.
   */
  NUMBER: (rule) => z.number({ error: messageFor(rule, '값은 숫자여야 합니다.') }),

  SELECT: (rule) =>
    z.enum([...rule.options], {
      error: messageFor(rule, `값은 정의된 선택지 중 하나여야 합니다: ${optionList(rule.options)}`),
    }),

  /**
   * An array of choices, each of them defined, none of them repeated.
   *
   * The duplicate check is not decoration: `["블랙", "블랙"]` renders as two
   * ticks on one box and, once Meilisearch indexes it, counts that product
   * twice in the facet count for 블랙.
   */
  MULTI_SELECT: (rule) =>
    z
      .array(
        z.enum([...rule.options], {
          error: `'${rule.label}'(${rule.key}) 값은 정의된 선택지 중에서 골라야 합니다: ${optionList(rule.options)}`,
        }),
        { error: messageFor(rule, '값은 선택지 배열이어야 합니다.') },
      )
      .check((ctx) => {
        if (new Set(ctx.value).size === ctx.value.length) return

        ctx.issues.push({
          code: 'custom',
          message: `'${rule.label}'(${rule.key}) 값에 같은 선택지가 두 번 들어 있습니다.`,
          input: ctx.value,
        })
      }),

  /** No coercion: the string `"false"` is truthy, and that is a silent bug. */
  BOOLEAN: (rule) => z.boolean({ error: messageFor(rule, '값은 true 또는 false 여야 합니다.') }),
}

/** The schema for one attribute's value, built from its definition. */
export function valueSchemaOf(rule: AttributeRule): z.ZodType {
  return VALUE_SCHEMAS[rule.type](rule)
}

/**
 * The schema for a whole `attributes` object, built from the rules that apply.
 *
 * Three properties are load-bearing, and each answers one of the completion
 * criteria.
 *
 * - **Strict.** A key with no definition is an error, not something to drop
 *   quietly (F5). Dropping would let a typo — `colour` for `color` — save as a
 *   product that simply has no colour, which nobody would notice until the
 *   facet came up empty.
 * - **Required rules are not optional.** So a missing one is an issue at that
 *   key (F4), reported *alongside* the other fields' issues rather than
 *   instead of them.
 * - **Absent values are stripped first.** `''`, `[]` and `null` mean "not
 *   given", so all four ways of saying nothing produce the same verdict.
 */
export function buildAttributesSchema(rules: readonly AttributeRule[]): z.ZodType {
  const shape = Object.fromEntries(
    rules.map((rule) => {
      const schema = valueSchemaOf(rule)

      return [rule.key, rule.isRequired ? schema : schema.optional()]
    }),
  )

  return z.preprocess(stripAbsent, z.strictObject(shape))
}

/** The message an undefined key gets. Named so the spec cannot drift from it. */
export function unknownKeyMessage(key: string): string {
  return `정의되지 않은 속성입니다: ${key}`
}

/** The message a non-object gets. */
export const NOT_AN_OBJECT_MESSAGE = '속성 값은 객체여야 합니다.'

/** Turns one zod issue into the field-level answer a caller can act on. */
function issuesOf(issue: z.core.$ZodIssue): readonly AttributeIssue[] {
  // `unrecognized_keys` names every offending key at once and sits at the root,
  // so it is the one issue that expands into several.
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => ({ key, message: unknownKeyMessage(key) }))
  }

  const [first] = issue.path

  return first === undefined
    ? [{ key: ROOT_ATTRIBUTE_KEY, message: NOT_AN_OBJECT_MESSAGE }]
    : [{ key: String(first), message: issue.message }]
}

/**
 * The verdict on one product's attribute values.
 *
 * The single entry point every save path has to go through (TASK-0030 4장 —
 * "상품 저장 경로가 이 함수를 우회할 수 없게 서비스 계층 한 곳으로 모은다").
 * It returns a result rather than throwing so that the same function can serve
 * an API that answers 400 and a screen that highlights fields, without either
 * of them needing a `try`.
 *
 * On success it hands back the **parsed** values, not the input: strings are
 * trimmed and nothing absent survives, so what reaches JSONB is normalised.
 */
export function validateAttributeValues(
  rules: readonly AttributeRule[],
  values: unknown,
): AttributeValidation {
  const parsed = buildAttributesSchema(rules).safeParse(values)

  if (parsed.success) return { ok: true, values: parsed.data as AttributeValues }

  return { ok: false, issues: parsed.error.issues.flatMap((issue) => issuesOf(issue)) }
}
