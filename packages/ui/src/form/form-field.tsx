'use client'

/**
 * The error display convention, as a component (TASK-0017 4.3).
 *
 * Every rule the convention states is enforced by where things are rendered
 * rather than by a note in a document:
 *
 * - the message sits directly under the control, after the hint;
 * - the colour is `text-danger` *and* the message is text, because colour on
 *   its own fails WCAG 1.4.1 and `Input`'s red border alone says nothing to a
 *   screen reader;
 * - `aria-describedby` lists **only ids that exist** — a reference to a missing
 *   element is an axe `aria-valid-attr-value` violation, so the hint and the
 *   error are added to the list one at a time;
 * - `aria-invalid` comes from the control's own `invalid` prop, which the
 *   binder in `useForm` sets from the same error.
 *
 * There is no `role="alert"` on a field error. Ten of them would announce at
 * once on a failed submit; instead `useForm` moves focus to the first invalid
 * control, and the message is read as that control's description.
 */

import type { ReactNode } from 'react'
import { Children, cloneElement, isValidElement } from 'react'

import { cx } from '../lib/cx'
import { describedBy, fieldIds } from './field-ids'
import type { FormApi } from './use-form'

export const FORM_FIELD_VARIANTS = ['control', 'group'] as const
export type FormFieldVariant = (typeof FORM_FIELD_VARIANTS)[number]

/** The props `FormField` injects into the control it wraps. */
interface InjectedControlProps {
  readonly id?: string
  readonly 'aria-describedby'?: string
  readonly 'aria-required'?: boolean
}

export interface FieldErrorProps {
  readonly id?: string
  readonly children?: ReactNode
  readonly className?: string
}

/** The message under a field. Renders nothing when there is no error. */
export function FieldError({ id, children, className }: FieldErrorProps) {
  if (children === undefined || children === null || children === '') return null

  return (
    <p className={cx('text-danger text-xs', className)} id={id}>
      {children}
    </p>
  )
}

export interface FormErrorProps {
  /** Messages that belong to no single field — server failures, cross-field rules. */
  readonly errors: readonly ReactNode[]
  readonly title?: ReactNode
  readonly className?: string
}

/**
 * The form level error box.
 *
 * `role="alert"` here and nowhere else: this element appears at most once per
 * submit, so announcing it is help rather than noise. `text-fg` on
 * `bg-danger-surface` is the pair `test/color-tokens.spec.ts` verifies —
 * `text-danger` on that background is not.
 */
export function FormError({ errors, title, className }: FormErrorProps) {
  if (errors.length === 0) return null

  return (
    <div
      className={cx(
        'border-danger bg-danger-surface text-fg flex flex-col gap-1 rounded-md border p-3 text-sm',
        className,
      )}
      role="alert"
    >
      {title === undefined ? null : <p className="font-medium">{title}</p>}
      <ul className="flex flex-col gap-1">
        {errors.map((error, index) => (
          <li key={index}>{error}</li>
        ))}
      </ul>
    </div>
  )
}

export interface FormFieldProps {
  readonly form: FormApi
  /** Field path, as it appears in the schema and in the values object. */
  readonly name: string
  readonly label: ReactNode
  readonly hint?: ReactNode
  readonly required?: boolean
  /**
   * `control` wraps one control and gives it the field's id and description.
   * `group` wraps several — a set of checkboxes, a radio group — in a
   * `fieldset`/`legend`, which is what associates a name with a set.
   */
  readonly variant?: FormFieldVariant
  readonly className?: string
  readonly children: ReactNode
}

export function FormField({
  form,
  name,
  label,
  hint,
  required = false,
  variant = 'control',
  className,
  children,
}: FormFieldProps) {
  const ids = fieldIds(form.id, name)
  const error = form.errorFor(name)
  const described = describedBy(ids, { error: error !== undefined, hint: hint !== undefined })

  const marker = required ? (
    <span aria-hidden="true" className="text-danger">
      {' *'}
    </span>
  ) : null

  const messages = (
    <>
      {hint === undefined ? null : (
        <p className="text-fg-subtle text-xs" id={ids.hint}>
          {hint}
        </p>
      )}
      <FieldError id={ids.error}>{error}</FieldError>
    </>
  )

  if (variant === 'group') {
    return (
      <fieldset
        aria-describedby={described}
        className={cx('flex flex-col gap-1 border-0 p-0', className)}
      >
        <legend className="text-fg-muted mb-1 text-sm">
          {label}
          {marker}
        </legend>
        {children}
        {messages}
      </fieldset>
    )
  }

  /**
   * The identity and the description are injected rather than passed by the
   * caller, so the label's `htmlFor`, the control's `id` and the ids listed in
   * `aria-describedby` cannot disagree. The binder (`form.text`, `form.choice`,
   * `form.toggle`) supplies the value and the invalid flag; this supplies the
   * wiring.
   */
  const child = Children.only(children)
  const control = isValidElement<InjectedControlProps>(child)
    ? cloneElement(child, {
        'aria-describedby': described,
        'aria-required': required || undefined,
        id: ids.control,
      })
    : child

  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label className="text-fg-muted text-sm" htmlFor={ids.control}>
        {label}
        {marker}
      </label>
      {control}
      {messages}
    </div>
  )
}
