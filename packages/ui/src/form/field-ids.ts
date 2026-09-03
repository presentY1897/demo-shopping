/**
 * The ids that tie a label, a hint and an error message to one control.
 *
 * Derived rather than generated per element so that `FormField` (which renders
 * the hint and the error) and `useForm` (which renders the control's props)
 * arrive at the same strings without talking to each other.
 *
 * The field name goes into the id verbatim, dots and all: `attributes.material`
 * is a legal HTML id, and sanitising it would let two distinct names collide
 * into one id — which is an axe `duplicate-id` violation and, worse, a label
 * pointing at the wrong input.
 */

export interface FieldIds {
  readonly control: string
  readonly hint: string
  readonly error: string
}

export function fieldIds(formId: string, name: string): FieldIds {
  const base = `${formId}-${name}`
  return { control: base, error: `${base}-error`, hint: `${base}-hint` }
}

/**
 * `aria-describedby`, listing **only elements that are rendered**.
 *
 * A reference to a missing id fails axe's `aria-valid-attr-value`, so the empty
 * case has to be `undefined` rather than an empty string — React drops an
 * `undefined` attribute and keeps an empty one.
 */
export function describedBy(
  ids: FieldIds,
  { hint, error }: { readonly hint: boolean; readonly error: boolean },
): string | undefined {
  const parts = [hint ? ids.hint : '', error ? ids.error : ''].filter((part) => part !== '')
  return parts.length === 0 ? undefined : parts.join(' ')
}
