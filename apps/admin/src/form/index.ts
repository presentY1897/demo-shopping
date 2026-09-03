/**
 * The form pieces this app needs until TASK-0017's form system lands.
 *
 * One directory, one barrel, no convention declared — see `field-errors.ts`.
 */

export { Field } from './field'
export type { FieldProps } from './field'
export { fieldAria, fieldErrorId, fieldHintId, hasFieldErrors } from './field-errors'
export type { FieldErrors } from './field-errors'
export { useSubmit } from './use-submit'
