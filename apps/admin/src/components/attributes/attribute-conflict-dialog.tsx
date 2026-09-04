'use client'

import type { AttributeDefinition } from '@shopping/shared'
import { Button, Modal, ModalClose } from '@shopping/ui/components'

import type { AttributeFormValues } from '@/lib/attributes/form-schema'
import type { AttributeMessages } from '@/messages'

interface AttributeConflictDialogProps {
  readonly open: boolean
  /** The definition as the API now holds it — somebody else's save. */
  readonly latest: AttributeDefinition
  /** What this operator had typed and tried to save. */
  readonly mine: AttributeFormValues
  readonly messages: AttributeMessages
  readonly pending: boolean
  readonly onCancel: () => void
  /** Puts `latest` into the form, unsaved, on its version. */
  readonly onReload: () => void
  /** Saves `mine` again, on top of `latest`, because a person chose to. */
  readonly onOverwrite: () => void
}

/**
 * What a 409 on save looks like to the person who hit save.
 *
 * The rule this dialog exists for: **never overwrite silently.** Last-write-wins
 * would take this operator's edit and drop a colleague's without either of them
 * noticing (DECISIONS 4장). So both versions are put on screen and a person
 * chooses — reload and lose only this edit, or overwrite deliberately, on the
 * version that is actually current.
 *
 * The comparison is of the fields this form can change. `key` and `type` are not
 * among them, so there is nothing to compare there: a conflict cannot have moved
 * them (TASK-0030 4.4).
 */
export function AttributeConflictDialog({
  open,
  latest,
  mine,
  messages,
  pending,
  onCancel,
  onReload,
  onOverwrite,
}: AttributeConflictDialogProps) {
  const { conflict } = messages

  const summary = (values: {
    label: string
    isRequired: boolean
    options: readonly string[]
  }): string =>
    [
      values.label,
      values.isRequired ? messages.yes : messages.no,
      ...(values.options.length === 0 ? [] : [values.options.join(', ')]),
    ].join(' · ')

  return (
    <Modal
      closeLabel={conflict.closeLabel}
      description={conflict.description}
      footer={
        <>
          <ModalClose>
            <Button variant="ghost">{conflict.cancel}</Button>
          </ModalClose>
          <Button loading={pending} onClick={onOverwrite} variant="danger">
            {conflict.overwriteLabel}
          </Button>
          <Button onClick={onReload} variant="primary">
            {conflict.reloadLabel}
          </Button>
        </>
      }
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      open={open}
      title={conflict.title}
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-fg-muted">{conflict.serverLabel}</dt>
        <dd>{summary(latest)}</dd>

        <dt className="text-fg-muted">{conflict.mineLabel}</dt>
        <dd>{summary(mine)}</dd>
      </dl>
    </Modal>
  )
}
