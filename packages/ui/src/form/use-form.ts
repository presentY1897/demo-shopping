'use client'

/**
 * Form state, validation and the submit guard.
 *
 * No form library sits under this (TASK-0017 4.1). Four of the six input
 * components in this package are Radix controlled components, so the part a
 * library is good at — collecting uncontrolled inputs by ref — would apply to
 * `Input` and `Textarea` only, while the parts this project actually needs
 * (blocking implicit submission, placing server errors, generating a form from
 * definitions) come from no library at all.
 *
 * The whole submit path is here rather than spread over the components so the
 * guard has exactly one door.
 */

import type { ChangeEvent, FormEvent } from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ZodType } from 'zod'

import type { FieldErrors, ValidationErrors } from './field-errors'
import { NO_ERRORS, validateWithSchema } from './field-errors'
import { fieldIds } from './field-ids'

export type FormValues = Readonly<Record<string, unknown>>

export interface UseFormOptions<T> {
  /**
   * The schema `apps/api` validates the same request with. Sharing the object,
   * not the rules, is what keeps the two ends from drifting.
   */
  readonly schema: ZodType<T>
  readonly initialValues: FormValues
  /** Runs only after the schema passes. Rejecting it is how a server error arrives. */
  readonly onSubmit: (values: T) => void | Promise<void>
  /**
   * Turns a rejected submit into messages.
   *
   * The app writes it, because the error envelope lives in `@shopping/shared`
   * and a component library has no business importing the API client. Pair it
   * with `serverFieldErrors`, which owns the `details` → field convention.
   */
  readonly mapError?: (error: unknown) => ValidationErrors | undefined
  /** Shown as a form level error when `mapError` places nothing. Copy from the app. */
  readonly submitErrorMessage?: string
}

/** Props for `Input` and `Textarea`. */
export interface TextBinding {
  readonly id: string
  readonly name: string
  readonly value: string
  readonly invalid: boolean
  readonly onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
}

/** Props for `Select` and `RadioGroup`. */
export interface ChoiceBinding {
  readonly id: string
  readonly name: string
  readonly value: string
  readonly invalid: boolean
  readonly onValueChange: (value: string) => void
}

/** Props for `Checkbox` and `Switch`. */
export interface ToggleBinding {
  readonly id: string
  readonly name: string
  readonly checked: boolean
  readonly invalid: boolean
  readonly onCheckedChange: (checked: boolean | 'indeterminate') => void
}

/** A set of checkboxes standing for one array valued field. */
export interface MultiBinding {
  readonly name: string
  readonly values: readonly string[]
  readonly invalid: boolean
  readonly isSelected: (value: string) => boolean
  readonly setSelected: (value: string, selected: boolean) => void
}

export interface FormApi {
  /** Unique per form instance; every field id is derived from it. */
  readonly id: string
  readonly values: FormValues
  readonly fieldNames: readonly string[]
  readonly fieldErrors: FieldErrors
  readonly formErrors: readonly string[]
  /** A request is in flight. Drives `Button.loading`. */
  readonly submitting: boolean
  /** A submit has been attempted at least once. */
  readonly submitted: boolean
  /**
   * Attach to the `<form>` element — `Form` does it for you.
   *
   * A **callback ref**, not a ref object: `FormApi` has to stay a plain value.
   * `react-hooks/refs` taints the whole object once a `RefObject` reaches a
   * `ref=` prop through it, and then every `form.submitting` in a render body
   * is reported as reading a ref during render. `Form` destructures before
   * rendering for the same reason.
   */
  readonly formRef: (node: HTMLFormElement | null) => void
  readonly handleSubmit: (event: FormEvent<HTMLFormElement>) => void
  /**
   * Submits from application code — an action button that is not a
   * `type="submit"`, a keyboard shortcut, a wizard step.
   *
   * Goes through `requestSubmit()` rather than calling the handler, so it
   * arrives at the same `onSubmit` event as a click and an Enter press do.
   * There is one door (TASK-0017 4.2), and this is how code knocks on it.
   */
  readonly submit: () => void
  readonly errorFor: (name: string) => string | undefined
  readonly setValue: (name: string, value: unknown) => void
  readonly reset: () => void
  readonly text: (name: string) => TextBinding
  readonly choice: (name: string) => ChoiceBinding
  readonly toggle: (name: string) => ToggleBinding
  readonly multi: (name: string) => MultiBinding
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

function asStringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []
}

export function useForm<T>({
  schema,
  initialValues,
  onSubmit,
  mapError,
  submitErrorMessage,
}: UseFormOptions<T>): FormApi {
  const id = useId()
  const [values, setValues] = useState<FormValues>(initialValues)
  const [errors, setErrors] = useState<ValidationErrors>(NO_ERRORS)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  /** Bumped on every failed submit so the focus effect runs again. */
  const [failures, setFailures] = useState(0)

  const formElement = useRef<HTMLFormElement | null>(null)
  const formRef = useCallback((node: HTMLFormElement | null): void => {
    formElement.current = node
  }, [])

  /**
   * The duplicate submit guard, and the reason it is a ref rather than state.
   *
   * `setSubmitting(true)` is not visible to a second event in the same tick —
   * React has not re-rendered yet — so a state check would let a double press
   * through. `Button.loading` has the same limitation, which is why it is the
   * second layer here and not the only one (QUALITY-GATES U3).
   */
  const busy = useRef(false)

  const runSubmit = useCallback(async (): Promise<void> => {
    setSubmitting(true)
    setSubmitted(true)

    const result = validateWithSchema(schema, values)

    if (!result.success) {
      setErrors({ fieldErrors: result.fieldErrors, formErrors: result.formErrors })
      setFailures((count) => count + 1)
      return
    }

    setErrors(NO_ERRORS)

    try {
      await onSubmit(result.data)
    } catch (error) {
      // `mapError` is the app's adapter over `serverFieldErrors`; without one,
      // or when it places nothing, the failure is still shown rather than
      // swallowed — a submit that appears to do nothing is the worst outcome.
      const mapped = mapError?.(error)
      setErrors(
        mapped ?? {
          fieldErrors: {},
          formErrors: submitErrorMessage === undefined ? [] : [submitErrorMessage],
        },
      )
      setFailures((count) => count + 1)
    }
  }, [mapError, onSubmit, schema, submitErrorMessage, values])

  /**
   * The single entry point for submitting, whatever caused it.
   *
   * A click on a submit button, `form.requestSubmit()`, and **Enter pressed in
   * a text field** all arrive here. That last one is the case `Button.loading`
   * cannot cover: when a form's action button is not a `type="submit"` button —
   * a modal footer, or a `type="button"` with an `onClick`, both ordinary
   * shapes in this project's console screens — the browser's implicit
   * submission never touches the button and the click guard never runs. The
   * reproduction is in `form.spec.tsx`.
   */
  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault()
      if (busy.current) return

      busy.current = true
      void runSubmit().finally(() => {
        busy.current = false
        setSubmitting(false)
      })
    },
    [runSubmit],
  )

  const submit = useCallback((): void => {
    formElement.current?.requestSubmit()
  }, [])

  /** Moves focus to the first invalid control so a screen reader announces it. */
  useEffect(() => {
    if (failures === 0) return
    formElement.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [failures])

  const setValue = useCallback((name: string, value: unknown): void => {
    setValues((previous) => ({ ...previous, [name]: value }))
    // The message described what the old value was wrong about. Re-validation
    // happens on the next submit; leaving it up while the user types is how a
    // form ends up shouting at somebody halfway through an email address.
    setErrors((previous) => {
      if (!(name in previous.fieldErrors)) return previous
      const { [name]: _cleared, ...rest } = previous.fieldErrors
      return { fieldErrors: rest, formErrors: previous.formErrors }
    })
  }, [])

  const reset = useCallback((): void => {
    setValues(initialValues)
    setErrors(NO_ERRORS)
    setSubmitted(false)
  }, [initialValues])

  const errorFor = useCallback(
    (name: string): string | undefined => errors.fieldErrors[name],
    [errors],
  )

  const api = useMemo<FormApi>(() => {
    const invalidFor = (name: string): boolean => errors.fieldErrors[name] !== undefined

    return {
      choice: (name) => ({
        id: fieldIds(id, name).control,
        invalid: invalidFor(name),
        name,
        onValueChange: (value: string) => {
          setValue(name, value)
        },
        value: asString(values[name]),
      }),
      errorFor,
      fieldErrors: errors.fieldErrors,
      fieldNames: Object.keys(initialValues),
      formErrors: errors.formErrors,
      formRef,
      handleSubmit,
      id,
      multi: (name) => {
        const selected = asStringList(values[name])
        return {
          invalid: invalidFor(name),
          isSelected: (value: string) => selected.includes(value),
          name,
          setSelected: (value: string, isOn: boolean) => {
            setValue(
              name,
              isOn ? [...selected, value] : selected.filter((entry) => entry !== value),
            )
          },
          values: selected,
        }
      },
      reset,
      setValue,
      submit,
      submitted,
      submitting,
      text: (name) => ({
        id: fieldIds(id, name).control,
        invalid: invalidFor(name),
        name,
        onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
          setValue(name, event.target.value)
        },
        value: asString(values[name]),
      }),
      toggle: (name) => ({
        checked: values[name] === true,
        id: fieldIds(id, name).control,
        invalid: invalidFor(name),
        name,
        onCheckedChange: (checked: boolean | 'indeterminate') => {
          setValue(name, checked === true)
        },
      }),
      values,
    }
  }, [
    errorFor,
    errors,
    formRef,
    handleSubmit,
    id,
    initialValues,
    reset,
    setValue,
    submit,
    submitted,
    submitting,
    values,
  ])

  return api
}
