import type { AttributeType, AttributeValue, AttributeValues } from '@shopping/shared'
import type { FieldDef, FieldType, FieldValue } from '@shopping/ui/form'
import { initialValuesForFields } from '@shopping/ui/form'

/**
 * The attribute half of the editor: definitions in, form fields out, and the
 * rule for what survives a change of category (TASK-0114 4장, R2).
 *
 * **The rule is the screen's alone.** The server validates whatever it is
 * finally sent and has no idea a category was ever changed; it could not have
 * one, because the change happens between two requests that are unrelated as
 * far as it is concerned. So this is not a duplicated rule, it is a rule with
 * one home — and it is a pure function so the home is testable.
 *
 * Why keep anything at all: 카테고리를 잘못 골랐다가 되돌리면 다시 입력해야
 * 한다. A seller who picks 코트 instead of 재킷, types six values and notices,
 * should get their six values back when they correct it.
 */

/**
 * The five types as the five controls the form generator knows.
 *
 * A `Record` with no default branch: `AttributeType` is a closed enum in the
 * database and in the contract, so a sixth type fails to compile here rather
 * than falling through to a text box. `apps/admin` maps the same five the same
 * way (TASK-0031) — the two consoles cannot disagree about what a `SELECT` is.
 */
const FIELD_TYPE_BY_ATTRIBUTE: Readonly<Record<AttributeType, FieldType>> = {
  TEXT: 'text',
  NUMBER: 'number',
  SELECT: 'select',
  MULTI_SELECT: 'multiselect',
  BOOLEAN: 'boolean',
}

/**
 * A definition as this form names it: `attributes.<key>`, not `<key>`.
 *
 * The prefix is the server's own path. `PRODUCT_ATTRIBUTES_REQUIRED` arrives
 * with `details[].field = "attributes.material"`, and `serverFieldErrors`
 * places a message by comparing that string against the form's field names — so
 * naming the field anything else would put every server-side attribute refusal
 * at the top of the form instead of under the input it is about (F6b).
 */
export const ATTRIBUTE_FIELD_PREFIX = 'attributes.'

export function attributeFieldName(key: string): string {
  return `${ATTRIBUTE_FIELD_PREFIX}${key}`
}

/** The definition key behind a field name, or `null` for any other field. */
export function attributeKeyOf(fieldName: string): string | null {
  return fieldName.startsWith(ATTRIBUTE_FIELD_PREFIX)
    ? fieldName.slice(ATTRIBUTE_FIELD_PREFIX.length)
    : null
}

/** The part of an `EffectiveAttribute` this module needs. Structural, so a spec can build one. */
export interface AttributeDefinitionLike {
  readonly key: string
  readonly label: string
  readonly type: AttributeType
  readonly options: readonly string[]
  readonly isRequired: boolean
}

/**
 * Definitions as `DynamicForm` wants them.
 *
 * `order` is the row's **position in the list**, not its `sortOrder`: the API
 * already answers general → specific with shadowing resolved (TASK-0030 4.1),
 * and `sortOrder` alone cannot express that — a root's 브랜드 and a leaf's
 * 넥라인 are both `0`. Handing over the index makes `resolveFields`' own sort a
 * no-op, which is the point: the ordering decision has one home.
 *
 * An option's stored string is both its value and its label. Attribute choices
 * are operator-entered Korean, not codes — there is no second form to show.
 */
export function attributeFields(
  definitions: readonly AttributeDefinitionLike[],
): readonly FieldDef[] {
  return definitions.map((definition, index) => ({
    key: attributeFieldName(definition.key),
    label: definition.label,
    type: FIELD_TYPE_BY_ATTRIBUTE[definition.type],
    options: definition.options.map((option) => ({ value: option, label: option })),
    required: definition.isRequired,
    order: index,
  }))
}

/**
 * A string that changes whenever the generated form's **shape** changes.
 *
 * `useForm` reads `initialValues` once, so a form whose field list grew a key
 * would keep a values object that has never heard of it — and a field removed
 * would leave its value behind to be validated forever. Remounting on this
 * signature is what keeps the two in step.
 *
 * Labels and `required` are deliberately not in it: they change what the form
 * *says*, not what it *holds*.
 */
export function fieldSignature(fields: readonly FieldDef[]): string {
  return fields.map((field) => `${field.key}:${field.type}`).join('|')
}

/** True when this value could have come from a control of that type. */
function fits(type: FieldType, value: FieldValue, options: readonly string[]): boolean {
  switch (type) {
    case 'boolean':
      return typeof value === 'boolean'

    case 'multiselect':
      // Every remaining choice has to still exist. A partially valid list would
      // silently drop one of the seller's answers, which is worse than asking
      // the question again.
      //
      // The **elements** are checked rather than the container:
      // `Array.isArray` widens a `readonly string[]` to `any[]`.
      return typeof value !== 'string' && typeof value !== 'boolean'
        ? value.every((entry: string) => options.includes(entry))
        : false

    case 'select':
      return typeof value === 'string' && (value === '' || options.includes(value))

    case 'number':
      // The generator holds numbers as text (`''` is "not answered"), so a
      // string that is not a number is not a number this form can carry back.
      return typeof value === 'string' && (value === '' || !Number.isNaN(Number(value)))

    case 'text':
      return typeof value === 'string'
  }
}

/**
 * The values to start the new category's form from.
 *
 * **Same key and a value the new control could hold** — both halves matter. The
 * key alone is not enough: two lineages may define `season` as a
 * `MULTI_SELECT` of 간절기·겨울 and as a `TEXT`, and carrying `['간절기']` into
 * a text box produces a value the generated schema refuses with a message about
 * a field nobody touched. A choice that no longer exists is dropped for the
 * same reason.
 *
 * Everything the new list does not ask about is gone, which is the other half
 * of the rule: a save must not carry a key the new category has no definition
 * for — the server refuses that as a 400, in a draft too (TASK-0113 4장).
 */
export function carryOverValues(
  previous: Readonly<Record<string, FieldValue>>,
  fields: readonly FieldDef[],
): Readonly<Record<string, FieldValue>> {
  const blank = initialValuesForFields(fields)

  return Object.fromEntries(
    fields.map((field) => {
      const held = previous[field.key]
      const empty = blank[field.key]!
      const options = (field.options ?? []).map((option) => option.value)

      if (held === undefined) return [field.key, empty]

      return [field.key, fits(field.type, held, options) ? held : empty]
    }),
  )
}

/**
 * A stored listing's attribute bag, as the generated form holds it.
 *
 * The two representations differ in one place and it is the one that bites: a
 * `NUMBER` is a number in the bag and **a string** in the form, because a
 * numeric input whose value is `0` before anybody touches it is
 * indistinguishable from one somebody set to zero (`field-def.ts`).
 */
export function formValuesFrom(
  attributes: AttributeValues,
  fields: readonly FieldDef[],
): Readonly<Record<string, FieldValue>> {
  const blank = initialValuesForFields(fields)

  return Object.fromEntries(
    fields.map((field) => {
      const key = attributeKeyOf(field.key)
      const stored = key === null ? undefined : attributes[key]
      const empty = blank[field.key]!

      if (stored === undefined) return [field.key, empty]
      if (typeof stored === 'number') return [field.key, String(stored)]

      return [field.key, fits(field.type, stored, optionsOf(field)) ? stored : empty]
    }),
  )
}

function optionsOf(field: FieldDef): readonly string[] {
  return (field.options ?? []).map((option) => option.value)
}

/**
 * The bag to send, built from what the generated schema returned.
 *
 * Blank answers are **left out** rather than sent as `''`. An empty string is a
 * value the definition would have to accept, and a draft that is allowed to be
 * incomplete says so by not carrying the key at all — which is exactly what
 * `PRODUCT_ATTRIBUTES_REQUIRED` looks for when the listing later goes on sale.
 */
export function attributeValuesFrom(
  values: Readonly<Record<string, unknown>>,
  fields: readonly FieldDef[],
): AttributeValues {
  const bag: Record<string, AttributeValue> = {}

  for (const field of fields) {
    const key = attributeKeyOf(field.key)
    const value = values[field.key]

    if (key === null || value === undefined || value === '') continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      bag[key] = value as string[]
      continue
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      bag[key] = value
    }
  }

  return bag
}
