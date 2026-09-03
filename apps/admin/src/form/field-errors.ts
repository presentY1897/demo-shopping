/**
 * Field level validation, as little of it as this screen needs.
 *
 * **This whole directory is a placeholder for TASK-0017.** That TASK is building
 * the form system — how a field error is shown, how a server error is mapped
 * onto a field, how a submit is locked while it is in flight — and inventing a
 * second convention here would mean two of them in the repository, with the
 * quieter one drifting. So the convention is not declared: what is here is the
 * minimum this one form needs, kept in one directory so that adopting the real
 * system is deleting `src/form/` and changing imports.
 *
 * Nothing outside `src/form/` implements any of it.
 */

/** Messages keyed by field name; a missing key means the field is fine. */
export type FieldErrors<TField extends string> = Partial<Readonly<Record<TField, string>>>

export function hasFieldErrors<TField extends string>(errors: FieldErrors<TField>): boolean {
  return Object.values(errors).some((message) => message !== undefined)
}

/** The id of the element that carries a field's error text. */
export function fieldErrorId(fieldId: string): string {
  return `${fieldId}-error`
}

/** The id of the element that carries a field's hint. */
export function fieldHintId(fieldId: string): string {
  return `${fieldId}-hint`
}

/**
 * The ARIA a control needs so that its error and hint are announced with it.
 *
 * Returned as a spread rather than applied by a wrapper component: `Input` and
 * `Select` come from `@shopping/ui` and this app only consumes them, so the
 * attributes have to reach the control itself.
 */
export function fieldAria(
  fieldId: string,
  options: { readonly error?: string | undefined; readonly hint?: string | undefined } = {},
): {
  readonly id: string
  readonly 'aria-invalid': boolean
  readonly 'aria-describedby': string | undefined
} {
  const described = [
    options.hint === undefined ? null : fieldHintId(fieldId),
    options.error === undefined ? null : fieldErrorId(fieldId),
  ].filter((value): value is string => value !== null)

  return {
    id: fieldId,
    'aria-invalid': options.error !== undefined,
    'aria-describedby': described.length === 0 ? undefined : described.join(' '),
  }
}
