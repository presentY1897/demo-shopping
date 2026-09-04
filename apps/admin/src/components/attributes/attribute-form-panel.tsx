'use client'

import type { AttributeType, EffectiveAttribute } from '@shopping/shared'
import { attributeTypeHasOptions, attributeTypes } from '@shopping/shared'
import { Button, Card, Checkbox, Input, Select } from '@shopping/ui/components'
import type { ValidationErrors } from '@shopping/ui/form'
import { Form, FormError, FormField, useForm } from '@shopping/ui/form'
import { useEffect, useMemo } from 'react'

import type { AttributeFormValues } from '@/lib/attributes/form-schema'
import { attributeFormSchema } from '@/lib/attributes/form-schema'
import type { AttributeDraft } from '@/lib/attributes/preview'
import type { AttributeMessages } from '@/messages'

import { AttributeOptionEditor } from './attribute-option-editor'

/**
 * What the caller's save attempt came back with.
 *
 * `rejected` carries messages **already placed** — the workspace resolved them
 * from `details[].field` and the message catalog, because it is the thing that
 * also owns the toast, the notice and the conflict dialog and therefore has to
 * make the recovery decision anyway (TASK-0117 4.5).
 */
export type AttributeFormOutcome =
  { readonly kind: 'saved' } | { readonly kind: 'rejected'; readonly errors: ValidationErrors }

/**
 * A refused save, on its way from the submit handler to `mapError`.
 *
 * An `Error` subclass rather than a thrown plain object: `useForm`'s failure
 * path is a rejected promise, and throwing a non-error is the thing lint rules
 * and stack traces both dislike. The messages it carries are already placed.
 */
class FormRejection extends Error {
  constructor(readonly errors: ValidationErrors) {
    super('attribute save rejected')
    this.name = 'FormRejection'
  }
}

export interface AttributeFormPanelProps {
  /** The definition being edited, or `undefined` while creating one. */
  readonly editing: EffectiveAttribute | undefined
  /** Where the definition lives — shown, not chosen, because the picker chose it. */
  readonly categoryName: string
  readonly messages: AttributeMessages
  readonly onCancel: () => void
  readonly onSubmit: (values: AttributeFormValues) => Promise<AttributeFormOutcome>
  /** Reports what is being typed, so the preview can show it (4.10). */
  readonly onDraftChange: (draft: AttributeDraft | null) => void
}

function initialFor(editing: EffectiveAttribute | undefined): Readonly<Record<string, unknown>> {
  return {
    key: editing?.key ?? '',
    label: editing?.label ?? '',
    type: editing?.type ?? '',
    options: editing?.options ?? [],
    isRequired: editing?.isRequired ?? false,
    isFilterable: editing?.isFilterable ?? false,
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asOptions(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

/**
 * Add or edit one definition, beside the preview it changes.
 *
 * **Not a dialog** (TASK-0031 4.11). The whole argument for this screen is that
 * an operator can see what a definition turns into while writing it, and a modal
 * covers exactly the panel that shows them.
 *
 * **`key` and `type` are read as text when editing.** Both change the meaning of
 * values already stored in `Product.attributes`, so the update request has no
 * place to send them (TASK-0030 4.4). They are rendered as text rather than as
 * disabled inputs: a disabled control is skipped by the tab order, so a keyboard
 * user could not read the value it was showing them.
 */
export function AttributeFormPanel({
  editing,
  categoryName,
  messages,
  onCancel,
  onSubmit,
  onDraftChange,
}: AttributeFormPanelProps) {
  const copy = messages.form
  const editingType = editing?.type
  const schema = useMemo(() => attributeFormSchema(copy.errors), [copy.errors])
  const initialValues = useMemo(() => initialFor(editing), [editing])

  const form = useForm<AttributeFormValues>({
    schema,
    initialValues,
    onSubmit: async (values) => {
      const outcome = await onSubmit(values)

      if (outcome.kind === 'rejected') throw new FormRejection(outcome.errors)
    },
    mapError: (error) => (error instanceof FormRejection ? error.errors : undefined),
    submitErrorMessage: copy.submitError,
  })

  const { values, setValue } = form
  const type = editingType ?? (asString(values.type) as AttributeType | '')

  /**
   * Tells the preview what is in the boxes right now.
   *
   * An effect rather than a callback on every control: there are six of them and
   * `useForm` owns the state, so watching the values object is the one place
   * that cannot miss a change. The `null` on unmount is what takes the draft out
   * of the preview when the panel closes.
   *
   * **A definition with no name is not previewed.** The generated control would
   * take its accessible name from the label and its identity from the key, so an
   * empty one produces a combobox nothing can address — an axe `button-name`
   * violation the moment a type is chosen, before a single character of the name
   * is typed. There is nothing to show until there is something to call it.
   */
  useEffect(() => {
    const key = asString(values.key).trim()
    const label = asString(values.label).trim()

    if (type === '' || key === '' || label === '') {
      onDraftChange(null)
      return
    }

    onDraftChange({
      id: editing?.id ?? null,
      key,
      label,
      type,
      options: asOptions(values.options),
      isRequired: values.isRequired === true,
      sortOrder: editing?.sortOrder ?? Number.MAX_SAFE_INTEGER,
    })
  }, [editing, onDraftChange, type, values])

  useEffect(
    () => () => {
      onDraftChange(null)
    },
    [onDraftChange],
  )

  const typeOptions = attributeTypes.map((candidate) => ({
    value: candidate,
    label: messages.typeLabels[candidate],
  }))

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-fg text-lg font-semibold">
        {editing === undefined ? copy.addTitle : copy.editTitle}
      </h2>

      <p className="text-fg-muted text-sm">
        {copy.categoryLabel}: <span className="text-fg font-medium">{categoryName}</span>
      </p>

      <Form aria-label={editing === undefined ? copy.addTitle : copy.editTitle} form={form}>
        <FormError errors={form.formErrors} />

        {editing === undefined ? (
          <FormField form={form} hint={copy.keyHint} label={copy.keyLabel} name="key" required>
            <Input {...form.text('key')} autoComplete="off" placeholder={copy.keyPlaceholder} />
          </FormField>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-fg-muted text-sm">{copy.keyLabel}</p>
            <code className="text-fg text-sm">{editing.key}</code>
            <p className="text-fg-subtle text-xs">{copy.keyLockedHint}</p>
          </div>
        )}

        <FormField form={form} label={copy.labelLabel} name="label" required>
          <Input {...form.text('label')} autoComplete="off" placeholder={copy.labelPlaceholder} />
        </FormField>

        {editing === undefined ? (
          <FormField
            form={form}
            hint={type === '' ? undefined : messages.typeHints[type]}
            label={copy.typeLabel}
            name="type"
            required
          >
            <Select
              {...form.choice('type')}
              onValueChange={(next) => {
                setValue('type', next)
                // Choices only mean anything to the two types that take them, and
                // the API refuses a list on any other (`optionIssues`). Dropping
                // them here means the refusal never has to be shown.
                if (!attributeTypeHasOptions(next as AttributeType)) setValue('options', [])
              }}
              options={typeOptions}
              placeholder={copy.typePlaceholder}
            />
          </FormField>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-fg-muted text-sm">{copy.typeLabel}</p>
            <p className="text-fg text-sm font-medium">{messages.typeLabels[editing.type]}</p>
            <p className="text-fg-subtle text-xs">{copy.typeLockedHint}</p>
          </div>
        )}

        {type !== '' && attributeTypeHasOptions(type) ? (
          <AttributeOptionEditor form={form} messages={copy} />
        ) : null}

        <FormField
          form={form}
          hint={copy.requiredHint}
          label={copy.requiredLabel}
          name="isRequired"
        >
          <Checkbox {...form.toggle('isRequired')} />
        </FormField>

        <FormField
          form={form}
          hint={copy.filterableHint}
          label={copy.filterableLabel}
          name="isFilterable"
        >
          <Checkbox {...form.toggle('isFilterable')} />
        </FormField>

        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} type="button" variant="ghost">
            {copy.cancel}
          </Button>
          <Button loading={form.submitting} type="submit" variant="primary">
            {form.submitting ? copy.saving : copy.save}
          </Button>
        </div>
      </Form>
    </Card>
  )
}
