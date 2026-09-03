import type { ReactNode } from 'react'

import { fieldErrorId, fieldHintId } from './field-errors'

/**
 * Label, control, hint and error in the arrangement this console uses.
 *
 * `@shopping/ui` has `Input`, `Select` and `Switch` but no field wrapper — the
 * package is deliberately a component set, not a form system — so this lives in
 * the app. It moves to TASK-0017's form system when that lands; see
 * `field-errors.ts` for why it is not a convention.
 */
export interface FieldProps {
  /** Must match the `id` given to the control, which `fieldAria` supplies. */
  readonly fieldId: string
  readonly label: ReactNode
  readonly hint?: ReactNode
  /** Rendered as an alert so a validation failure is announced, not just drawn. */
  readonly error?: string | undefined
  readonly required?: boolean
  readonly children: ReactNode
}

export function Field({ fieldId, label, hint, error, required = false, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium" htmlFor={fieldId}>
        {label}
        {required ? (
          <span aria-hidden="true" className="text-danger ms-1">
            *
          </span>
        ) : null}
      </label>

      {children}

      {hint === undefined ? null : (
        <p className="text-fg-subtle text-sm" id={fieldHintId(fieldId)}>
          {hint}
        </p>
      )}

      {error === undefined ? null : (
        <p className="text-danger text-sm" id={fieldErrorId(fieldId)} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
