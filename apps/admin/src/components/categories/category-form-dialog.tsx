'use client'

import { categoryNameSchema, categorySlugSchema } from '@shopping/shared'
import { Button, Input, Modal, ModalClose } from '@shopping/ui/components'
import { useState } from 'react'

import type { FieldErrors } from '@/form'
import { Field, fieldAria, hasFieldErrors, useSubmit } from '@/form'
import type { CategoryMessages } from '@/messages'

export interface CategoryFormValues {
  readonly name: string
  readonly slug: string
}

/** What the caller's save attempt came back with, in the terms this form shows. */
export type CategoryFormOutcome = 'saved' | 'slug-taken' | 'failed'

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
  const { form } = messages

  const { submitting, submit } = useSubmit(async (): Promise<void> => {
    const found = validate(values, messages)
    setErrors(found)
    if (hasFieldErrors(found)) return

    const outcome = await onSubmit(values)
    if (outcome === 'slug-taken') setErrors({ slug: form.errors.slugTaken })
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
