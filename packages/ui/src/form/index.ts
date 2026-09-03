/**
 * The form layer (TASK-0017).
 *
 * A separate entry point from `@shopping/ui/components` because it is a
 * different kind of thing: `components` ships controls that know nothing about
 * each other, and this ships the rules that hold a set of them together — one
 * schema, one error convention, one submit guard, one confirmation.
 *
 * Everything here is client side. The pure modules (`field-def`,
 * `field-errors`, `field-ids`, `server-errors`) carry no directive and can be
 * imported by a server component or by a test that renders nothing.
 */

export { Form } from './form'
export type { FormProps } from './form'

export { FieldError, FormError, FormField, FORM_FIELD_VARIANTS } from './form-field'
export type {
  FieldErrorProps,
  FormErrorProps,
  FormFieldProps,
  FormFieldVariant,
} from './form-field'

export { DynamicForm } from './dynamic-form'
export type { DynamicFormProps } from './dynamic-form'

export { ConfirmDialog, useConfirm } from './confirm-dialog'
export type { ConfirmDialogProps, ConfirmGate } from './confirm-dialog'

export { useForm } from './use-form'
export type {
  ChoiceBinding,
  FormApi,
  FormValues,
  MultiBinding,
  TextBinding,
  ToggleBinding,
  UseFormOptions,
} from './use-form'

export {
  FIELD_CONTROLS,
  FIELD_TYPES,
  initialValuesForFields,
  resolveFields,
  schemaForFields,
} from './field-def'
export type {
  FieldControl,
  FieldDef,
  FieldMessages,
  FieldOption,
  FieldType,
  FieldValue,
  ResolvedField,
} from './field-def'

export {
  fieldPathOf,
  mergeValidationErrors,
  NO_ERRORS,
  validateWithSchema,
  validationErrorsFrom,
} from './field-errors'
export type {
  FieldErrors,
  ValidationErrors,
  ValidationIssue,
  ValidationResult,
} from './field-errors'

export { describedBy, fieldIds } from './field-ids'
export type { FieldIds } from './field-ids'

export { serverFieldErrors } from './server-errors'
export type { ServerErrorOptions } from './server-errors'
