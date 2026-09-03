'use client'

/**
 * The `<form>` element, and the door every submit has to come through.
 *
 * Two attributes carry the decisions.
 *
 * `noValidate` turns off the browser's own constraint validation. Native
 * `required` and `pattern` would report in the browser's wording, in the
 * browser's language, in a bubble nobody can position — and would fire *before*
 * the submit event, so the schema in `packages/shared` would never get a say.
 * One validator, and it is zod (TASK-0017 4.1).
 *
 * `onSubmit` is `useForm`'s guarded handler. It is the only place a submit can
 * be blocked, because it is the only place every submit arrives: a click on a
 * `type="submit"` button, `requestSubmit()` from application code, and **Enter
 * pressed in a text field**. `Button.loading` covers the first of those and
 * nothing else, which is the hole TASK-0017 4.2 measures and `form.spec.tsx`
 * reproduces.
 */

import type { ReactNode } from 'react'

import { cx } from '../lib/cx'
import type { FormApi } from './use-form'

export interface FormProps {
  readonly form: FormApi
  readonly children: ReactNode
  readonly className?: string
  readonly id?: string
  readonly 'aria-label'?: string
  readonly 'aria-labelledby'?: string
}

export function Form({ form, children, className, ...rest }: FormProps) {
  const { formRef, handleSubmit, submitting } = form

  return (
    <form
      aria-busy={submitting || undefined}
      className={cx('flex flex-col gap-4', className)}
      noValidate
      onSubmit={handleSubmit}
      ref={formRef}
      {...rest}
    >
      {children}
    </form>
  )
}
