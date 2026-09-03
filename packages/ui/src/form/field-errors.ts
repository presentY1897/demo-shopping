/**
 * The zod ↔ form adapter: one validation result, split into what each part of
 * the form has to draw.
 *
 * There is deliberately no message catalogue here. Copy belongs to the schema
 * (`packages/shared`) or to the props the app passes; a component library that
 * wrote Korean sentences would be the one place the message could not be
 * changed without a release of the design system.
 */

import type { ZodType } from 'zod'

/** Field path → the message shown under that field. One message per field. */
export type FieldErrors = Readonly<Record<string, string>>

/** The part of a zod issue this module reads. Structural, so a bare object works in a test. */
export interface ValidationIssue {
  readonly path: readonly PropertyKey[]
  readonly message: string
}

export interface ValidationErrors {
  readonly fieldErrors: FieldErrors
  /** Issues that name no field — a refinement over the whole object. */
  readonly formErrors: readonly string[]
}

export const NO_ERRORS: ValidationErrors = { fieldErrors: {}, formErrors: [] }

/**
 * `['items', 0, 'price']` → `'items.0.price'`.
 *
 * Dots for every segment, including array indices. Bracket notation would give
 * the same field two spellings (`items[0].price` and `items.0.price`) and the
 * server error mapper compares these strings against field names.
 */
export function fieldPathOf(path: readonly PropertyKey[]): string {
  return path.map((segment) => String(segment)).join('.')
}

/**
 * Splits issues into per-field and form-level messages.
 *
 * **The first issue for a path wins.** A field shows one message: zod happily
 * reports "too short" and "wrong format" for the same string, and stacking both
 * under one input is noise, not help.
 */
export function validationErrorsFrom(issues: readonly ValidationIssue[]): ValidationErrors {
  const fieldErrors: Record<string, string> = {}
  const formErrors: string[] = []

  for (const issue of issues) {
    const path = fieldPathOf(issue.path)

    if (path === '') {
      formErrors.push(issue.message)
      continue
    }
    if (path in fieldErrors) continue

    fieldErrors[path] = issue.message
  }

  return { fieldErrors, formErrors }
}

export type ValidationResult<T> =
  { readonly success: true; readonly data: T } | ({ readonly success: false } & ValidationErrors)

/**
 * Runs the schema the API validates with, against the values the form holds.
 *
 * This is the whole of "client and server share one schema" (TASK-0017 F1):
 * `apps/api` calls `parseInput(schema, body)` with the very object from
 * `packages/shared` that the caller passes here, so a rule cannot be enforced on
 * one side only.
 */
export function validateWithSchema<T>(schema: ZodType<T>, values: unknown): ValidationResult<T> {
  const result = schema.safeParse(values)

  if (result.success) return { success: true, data: result.data }

  return { success: false, ...validationErrorsFrom(result.error.issues) }
}

/** Merges two error sets, with the later one winning per field. */
export function mergeValidationErrors(
  first: ValidationErrors,
  second: ValidationErrors,
): ValidationErrors {
  return {
    fieldErrors: { ...first.fieldErrors, ...second.fieldErrors },
    formErrors: [...first.formErrors, ...second.formErrors],
  }
}
