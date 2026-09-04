import {
  PRODUCT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_MAX_PURCHASE_QUANTITY,
  PRODUCT_NAME_MAX_LENGTH,
} from '@shopping/shared'
import type { FieldDef, FieldMessages, FieldValue, FormValues } from '@shopping/ui/form'
import { initialValuesForFields, schemaForFields } from '@shopping/ui/form'
import { z } from 'zod'

import { carryOverValues } from './attribute-values'

/**
 * The schema the editor's form validates against, and the values it starts from.
 *
 * **Base fields and generated fields in one object**, because there is one
 * form: `useForm` validates one schema, `Form` submits through one door, and a
 * screen with two of either cannot say which of them refused a submit
 * (TASK-0017 4.2).
 *
 * The generated half is `schemaForFields` — TASK-0030's server side generator's
 * counterpart — so a required attribute is required in the browser for the same
 * reason it is required on the server, from the same definition. Writing the
 * rules again here is how the two ends drift.
 */

/** The base fields, which every category's form has. */
export const PRODUCT_BASE_FIELDS = ['name', 'description', 'maxPurchaseQuantity'] as const

/** One sentence per way a base input can be wrong. Copy comes from the catalog. */
export interface ProductFieldErrorMessages {
  readonly nameRequired: string
  readonly nameTooLong: string
  readonly descriptionTooLong: string
  readonly purchaseLimitRange: string
}

/** Copy for the messages the generated half produces. */
export interface ProductAttributeErrorMessages {
  readonly required: string
  readonly invalidNumber: string
  readonly invalidChoice: string
}

/** `'{label} 을(를) 입력해주세요'` + `옷감` → the sentence with the label in it. */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}

export function attributeFieldMessages(messages: ProductAttributeErrorMessages): FieldMessages {
  return {
    required: (field) => fill(messages.required, { label: field.label }),
    invalidNumber: (field) => fill(messages.invalidNumber, { label: field.label }),
    invalidChoice: (field) => fill(messages.invalidChoice, { label: field.label }),
  }
}

/**
 * The whole form's schema.
 *
 * `maxPurchaseQuantity` is text in and a number out, like every numeric input
 * the generator produces: `''` has to stay distinguishable from `0`, and a
 * control that started at `0` would make "no cap" impossible to express.
 */
export function productFormSchema(
  fields: readonly FieldDef[],
  messages: {
    readonly base: ProductFieldErrorMessages
    readonly attributes: ProductAttributeErrorMessages
  },
): z.ZodObject<Record<string, z.ZodType>> {
  return schemaForFields(fields, attributeFieldMessages(messages.attributes)).extend({
    name: z
      .string()
      .trim()
      .min(1, messages.base.nameRequired)
      .max(PRODUCT_NAME_MAX_LENGTH, messages.base.nameTooLong),
    description: z
      .string()
      .trim()
      .max(PRODUCT_DESCRIPTION_MAX_LENGTH, messages.base.descriptionTooLong),
    maxPurchaseQuantity: z
      .string()
      .trim()
      .refine(
        (value) =>
          value === '' ||
          (Number.isInteger(Number(value)) &&
            Number(value) >= 1 &&
            Number(value) <= PRODUCT_MAX_PURCHASE_QUANTITY),
        messages.base.purchaseLimitRange,
      ),
  })
}

/** What a base field holds before anybody types. */
export interface ProductBaseValues {
  readonly name: string
  readonly description: string
  readonly maxPurchaseQuantity: string
}

export const EMPTY_BASE_VALUES: ProductBaseValues = {
  name: '',
  description: '',
  maxPurchaseQuantity: '',
}

/**
 * The values a form instance starts from.
 *
 * Called again whenever the generated shape changes, with the values the
 * previous instance held: {@link carryOverValues} keeps every attribute whose
 * key **and type** survived the change of category, and the base fields survive
 * unconditionally because no category has an opinion about a product's name.
 */
export function productFormValues(
  base: ProductBaseValues,
  attributes: Readonly<Record<string, FieldValue>>,
  fields: readonly FieldDef[],
): FormValues {
  return { ...carryOverValues(attributes, fields), ...base }
}

/** The blank attribute half, for a form nobody has typed into yet. */
export function emptyAttributeValues(
  fields: readonly FieldDef[],
): Readonly<Record<string, FieldValue>> {
  return initialValuesForFields(fields)
}

/**
 * The base half of a values object, read back out.
 *
 * Used when the form is about to be remounted: the seller's name and
 * description belong to them, not to the category they happened to have chosen.
 */
export function baseValuesOf(values: FormValues): ProductBaseValues {
  return {
    name: asText(values.name),
    description: asText(values.description),
    maxPurchaseQuantity: asText(values.maxPurchaseQuantity),
  }
}

/** The attribute half, read back out — everything that is not a base field. */
export function attributeValuesOf(values: FormValues): Readonly<Record<string, FieldValue>> {
  const base: readonly string[] = PRODUCT_BASE_FIELDS

  return Object.fromEntries(
    Object.entries(values)
      .filter(([key]) => !base.includes(key))
      .map(([key, value]) => [key, asFieldValue(value)]),
  )
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)

  return ''
}

function asFieldValue(value: unknown): FieldValue {
  if (typeof value === 'boolean') return value
  if (Array.isArray(value))
    return value.filter((entry): entry is string => typeof entry === 'string')

  return asText(value)
}
