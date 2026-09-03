/**
 * The dynamic form generator, as pure functions.
 *
 * Three transformations, no React and no DOM: a definition list becomes an
 * ordered list of controls, an empty set of values, and the zod schema that
 * validates them. `DynamicForm` is a thin renderer over the first; `useForm`
 * takes the other two.
 *
 * **The five types are not a design choice made here.** They are
 * `AttributeDefinition.type` from TASK-0030 — `TEXT` · `NUMBER` · `SELECT` ·
 * `MULTI_SELECT` · `BOOLEAN` — mapped one to one, which is TASK-0017 R1's
 * answer to "will this fit M05?". A sixth type added on this side would be a
 * control no attribute definition can ever produce.
 *
 * There is no message catalogue in this file. `schemaForFields` takes the copy
 * as an argument so the Korean lives in the app that shows it.
 */

import { z } from 'zod'

export const FIELD_TYPES = ['text', 'number', 'select', 'multiselect', 'boolean'] as const
export type FieldType = (typeof FIELD_TYPES)[number]

/** The control a type renders as. Two types share `checkbox-group`'s sibling. */
export const FIELD_CONTROLS = ['input', 'number-input', 'select', 'checkbox-group', 'checkbox']
export type FieldControl = (typeof FIELD_CONTROLS)[number]

const CONTROL_BY_TYPE: Readonly<Record<FieldType, FieldControl>> = {
  boolean: 'checkbox',
  multiselect: 'checkbox-group',
  number: 'number-input',
  select: 'select',
  text: 'input',
}

export interface FieldOption {
  readonly value: string
  readonly label: string
}

/** One field, as an attribute definition or an admin screen states it. */
export interface FieldDef {
  readonly key: string
  readonly label: string
  readonly type: FieldType
  /** Required for `select` and `multiselect`; ignored by the other types. */
  readonly options?: readonly FieldOption[]
  readonly required?: boolean
  /** Display order. Ties break on `key` so the result never depends on input order. */
  readonly order?: number
  readonly hint?: string
  readonly placeholder?: string
}

/** A definition with every default filled in, ready to render. */
export interface ResolvedField {
  readonly key: string
  readonly label: string
  readonly type: FieldType
  readonly control: FieldControl
  readonly options: readonly FieldOption[]
  readonly required: boolean
  readonly order: number
  readonly hint: string | undefined
  readonly placeholder: string | undefined
}

/**
 * Fills the defaults and puts the fields in display order.
 *
 * Sorted here rather than in the renderer because the order is part of the
 * definition (`AttributeDefinition.sortOrder`), and a renderer that sorted
 * would give a preview screen and a product form two different answers to the
 * same question. Ties break on `key`: two attributes at order 0 must not swap
 * places depending on the order the API happened to return them in.
 */
export function resolveFields(defs: readonly FieldDef[]): readonly ResolvedField[] {
  return defs
    .map((def) => ({
      control: CONTROL_BY_TYPE[def.type],
      hint: def.hint,
      key: def.key,
      label: def.label,
      options: def.options ?? [],
      order: def.order ?? 0,
      placeholder: def.placeholder,
      required: def.required ?? false,
      type: def.type,
    }))
    .sort((a, b) => (a.order === b.order ? a.key.localeCompare(b.key) : a.order - b.order))
}

/** What every field holds before anybody types. */
export type FieldValue = string | boolean | readonly string[]

const EMPTY_BY_TYPE: Readonly<Record<FieldType, FieldValue>> = {
  boolean: false,
  multiselect: [],
  number: '',
  select: '',
  text: '',
}

/**
 * The blank form.
 *
 * `number` starts as `''` rather than `0`: a numeric input whose value is `0`
 * before anybody touches it is indistinguishable from one somebody set to zero,
 * and "required" would never fire.
 */
export function initialValuesForFields(
  defs: readonly FieldDef[],
): Readonly<Record<string, FieldValue>> {
  return Object.fromEntries(defs.map((def) => [def.key, EMPTY_BY_TYPE[def.type]]))
}

/** Copy for the messages the generated schema produces. Supplied by the app. */
export interface FieldMessages {
  readonly required: (field: ResolvedField) => string
  readonly invalidNumber: (field: ResolvedField) => string
  readonly invalidChoice: (field: ResolvedField) => string
}

/** `''`, `null` and `undefined` all mean "not answered". */
function blankToUndefined(value: unknown): unknown {
  return value === '' || value === null || value === undefined ? undefined : value
}

/**
 * An enum over the definition's own options.
 *
 * An empty option list is a broken definition rather than a crash: `z.enum([])`
 * accepts nothing, so a required field reports "required" and an optional one
 * only accepts being left alone — which is exactly what a control with no
 * choices can produce.
 */
function choiceSchema(field: ResolvedField, messages: FieldMessages): z.ZodType<string> {
  const values = field.options.map((option) => option.value)

  return z.enum(values, {
    error: (issue) =>
      issue.input === undefined ? messages.required(field) : messages.invalidChoice(field),
  })
}

function schemaForField(field: ResolvedField, messages: FieldMessages): z.ZodType {
  switch (field.type) {
    case 'text':
      return field.required ? z.string().trim().min(1, messages.required(field)) : z.string().trim()

    case 'number':
      return z.preprocess(
        (value) => (blankToUndefined(value) === undefined ? undefined : Number(value)),
        field.required
          ? z.number({
              error: (issue) =>
                issue.input === undefined
                  ? messages.required(field)
                  : messages.invalidNumber(field),
            })
          : z.number({ error: messages.invalidNumber(field) }).optional(),
      )

    case 'select':
      return field.required
        ? z.preprocess(blankToUndefined, choiceSchema(field, messages))
        : z.preprocess(blankToUndefined, choiceSchema(field, messages).optional())

    case 'multiselect': {
      const list = z.array(choiceSchema(field, messages))
      return field.required ? list.min(1, messages.required(field)) : list
    }

    case 'boolean':
      return z.boolean({ error: messages.required(field) })
  }
}

/**
 * The schema the generated form validates against.
 *
 * The mirror of TASK-0030's server side generator: the same definition list
 * produces the same rules on both ends, which is what makes "the client blocks
 * it first, and the server blocks it if the client is bypassed" (F1) true for
 * attributes nobody wrote a schema for by hand.
 */
export function schemaForFields(
  defs: readonly FieldDef[],
  messages: FieldMessages,
): z.ZodObject<Record<string, z.ZodType>> {
  const shape = Object.fromEntries(
    resolveFields(defs).map((field) => [field.key, schemaForField(field, messages)]),
  )

  return z.object(shape)
}
