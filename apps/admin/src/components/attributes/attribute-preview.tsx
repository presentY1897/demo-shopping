'use client'

import { Badge, Card, EmptyState } from '@shopping/ui/components'
import type { FieldDef, FieldMessages } from '@shopping/ui/form'
import { DynamicForm, initialValuesForFields, schemaForFields, useForm } from '@shopping/ui/form'
import { useMemo } from 'react'

import type { PreviewAttribute } from '@/lib/attributes/preview'
import { attributeFields, fieldSignature } from '@/lib/attributes/preview'
import { fill } from '@/lib/attributes/text'
import type { AttributePreviewMessages } from '@/messages'

interface GeneratedFormProps {
  readonly fields: readonly FieldDef[]
  readonly messages: AttributePreviewMessages
}

/**
 * The form a definition list produces, rendered by the generator that will
 * render it for the seller (TASK-0114).
 *
 * Its own component because it is remounted whenever the field **shape**
 * changes: `useForm` reads `initialValues` on the first render only, so a values
 * object that outlived a field would keep a key nothing asks about and lose one
 * that everything does. The caller supplies the `key`.
 */
function GeneratedForm({ fields, messages }: GeneratedFormProps) {
  const fieldMessages = useMemo<FieldMessages>(
    () => ({
      required: (field) => fill(messages.errors.required, { label: field.label }),
      invalidNumber: (field) => fill(messages.errors.invalidNumber, { label: field.label }),
      invalidChoice: (field) => fill(messages.errors.invalidChoice, { label: field.label }),
    }),
    [messages],
  )

  const form = useForm({
    schema: useMemo(() => schemaForFields(fields, fieldMessages), [fieldMessages, fields]),
    initialValues: useMemo(() => initialValuesForFields(fields), [fields]),
    onSubmit: () => undefined,
  })

  return <DynamicForm fields={fields} form={form} />
}

interface AttributePreviewProps {
  readonly rows: readonly PreviewAttribute[]
  readonly messages: AttributePreviewMessages
}

/**
 * What a seller will be asked when they add a product to this category.
 *
 * **The same generator, not a drawing of it** (TASK-0031 R1). `DynamicForm` and
 * `schemaForFields` are TASK-0017's, and TASK-0114's product editor calls the
 * same two with the same definitions, so this panel cannot drift from the real
 * form without the real form changing too.
 *
 * There is no submit button. A control that can be pressed and does nothing is
 * not a preview of anything.
 */
export function AttributePreview({ rows, messages }: AttributePreviewProps) {
  const fields = attributeFields(rows)
  const hasDraft = rows.some((row) => row.draft)

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-fg text-lg font-semibold">{messages.title}</h2>
        {hasDraft ? <Badge variant="warning">{messages.draftBadge}</Badge> : null}
      </div>
      <p className="text-fg-muted text-sm">{messages.description}</p>

      {fields.length === 0 ? (
        <EmptyState description={messages.emptyDescription} title={messages.emptyTitle} />
      ) : (
        <GeneratedForm fields={fields} key={fieldSignature(fields)} messages={messages} />
      )}
    </Card>
  )
}
