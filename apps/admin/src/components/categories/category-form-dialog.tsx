'use client'

import { categoryNameSchema, categorySlugSchema } from '@shopping/shared'
import { Button, Input, Modal, ModalClose } from '@shopping/ui/components'
import { useEffect, useRef, useState } from 'react'

import type { FieldErrors } from '@/form'
import { Field, fieldAria, hasFieldErrors, useSubmit } from '@/form'
import type { CategoryMessages } from '@/messages'

export interface CategoryFormValues {
  readonly name: string
  readonly slug: string
}

/**
 * What the caller's save attempt came back with, in the terms this form shows.
 *
 * `rejected` carries messages already **placed on fields** — the caller resolved
 * them from `details[].field` and the message catalog (TASK-0117 4.5). It used
 * to be the single token `'slug-taken'`, which was all the screen could work out
 * from a 409 and which said nothing about *why* it thought so.
 */
export type CategoryFormOutcome =
  | { readonly kind: 'saved' }
  | { readonly kind: 'rejected'; readonly fieldErrors: FieldErrors<Field_> }

type Field_ = 'name' | 'slug'

interface CategoryFormDialogProps {
  readonly open: boolean
  readonly title: string
  /** Where the category will live — the parent's name, or "최상위". */
  readonly parent: string
  readonly initial: CategoryFormValues
  readonly messages: CategoryMessages
  readonly onCancel: () => void
  readonly onSubmit: (values: CategoryFormValues) => Promise<CategoryFormOutcome>
}

/**
 * Validates the two fields against the **contract's** own schemas.
 *
 * `categoryNameSchema` and `categorySlugSchema` are what the API validates with,
 * so the rule is stated once (gate C1 read from the request side): a slug the
 * form accepts is a slug the endpoint accepts, and a rule that changes there
 * changes here. Only the wording is this app's.
 */
function validate(values: CategoryFormValues, messages: CategoryMessages): FieldErrors<Field_> {
  const errors: { name?: string; slug?: string } = {}
  const { errors: copy } = messages.form

  if (!categoryNameSchema.safeParse(values.name).success) {
    errors.name = values.name.trim() === '' ? copy.nameRequired : copy.nameTooLong
  }
  if (!categorySlugSchema.safeParse(values.slug).success) {
    errors.slug = values.slug.trim() === '' ? copy.slugRequired : copy.slugFormat
  }

  return errors
}

/**
 * Add or rename a category.
 *
 * This is the half of the screen that does **not** save as you go: a name is
 * typed in stages and every intermediate state would otherwise be published
 * (TASK-0029 4장). Moves are the opposite and have no save button at all.
 *
 * The dialog is mounted per opening (the caller gives it a `key`), so the fields
 * always start from `initial` and the conflict dialog can hand it a fresh set of
 * server values simply by changing that key.
 */
export function CategoryFormDialog({
  open,
  title,
  parent,
  initial,
  messages,
  onCancel,
  onSubmit,
}: CategoryFormDialogProps) {
  const [values, setValues] = useState<CategoryFormValues>(initial)
  const [errors, setErrors] = useState<FieldErrors<Field_>>({})
  /** Bumped on every rejected submit so the focus effect runs again. */
  const [rejections, setRejections] = useState(0)
  const formRef = useRef<HTMLFormElement | null>(null)
  const { form } = messages

  /**
   * Moves focus to the first control the server or the schema objected to.
   *
   * Without it the message is announced only if the reader happens to be on that
   * field, and on a dialog with two inputs the second one is exactly where they
   * are not. `aria-invalid` is set by `fieldAria`, so the query finds the same
   * control the error is described by (TASK-0017 규약, TASK-0117 F4).
   */
  useEffect(() => {
    if (rejections === 0) return
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [rejections])

  const reject = (found: FieldErrors<Field_>): void => {
    setErrors(found)
    setRejections((count) => count + 1)
  }

  const { submitting, submit } = useSubmit(async (): Promise<void> => {
    const found = validate(values, messages)

    if (hasFieldErrors(found)) {
      reject(found)
      return
    }
    setErrors({})

    const outcome = await onSubmit(values)

    if (outcome.kind === 'rejected') reject(outcome.fieldErrors)
  })

  return (
    <Modal
      closeLabel={form.closeLabel}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      open={open}
      title={title}
    >
      {/*
        The buttons live inside the `<form>` rather than in the modal's footer
        slot: a submit button associated by the `form` attribute works, but only
        because of an association nothing in this file would show — and this
        form's whole point is that saving is explicit.
      */}
      <form
        className="flex flex-col gap-4"
        noValidate
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <p className="text-fg-muted text-sm">
          {form.parentLabel}: <span className="text-fg font-medium">{parent}</span>
        </p>

        <Field error={errors.name} fieldId="category-name" label={form.nameLabel} required>
          <Input
            {...fieldAria('category-name', { error: errors.name })}
            autoComplete="off"
            onChange={(event) => {
              setValues((current) => ({ ...current, name: event.target.value }))
            }}
            placeholder={form.namePlaceholder}
            value={values.name}
          />
        </Field>

        <Field
          error={errors.slug}
          fieldId="category-slug"
          hint={form.slugHint}
          label={form.slugFieldLabel}
          required
        >
          <Input
            {...fieldAria('category-slug', { error: errors.slug, hint: form.slugHint })}
            autoComplete="off"
            onChange={(event) => {
              setValues((current) => ({ ...current, slug: event.target.value }))
            }}
            placeholder={form.slugPlaceholder}
            value={values.slug}
          />
        </Field>

        <div className="flex justify-end gap-2">
          <ModalClose>
            <Button type="button" variant="ghost">
              {form.cancel}
            </Button>
          </ModalClose>
          <Button loading={submitting} type="submit" variant="primary">
            {submitting ? form.saving : form.save}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
