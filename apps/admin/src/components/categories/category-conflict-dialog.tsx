'use client'

import { Button, Modal, ModalClose } from '@shopping/ui/components'

import type { CategoryRow } from '@/lib/categories/tree'
import type { CategoryMessages } from '@/messages'

import type { CategoryFormValues } from './category-form-dialog'

interface CategoryConflictDialogProps {
  readonly open: boolean
  /** The row as the API now holds it — somebody else's save. */
  readonly latest: CategoryRow
  /** What this operator had typed and tried to save. */
  readonly mine: CategoryFormValues
  readonly messages: CategoryMessages
  readonly pending: boolean
  readonly onCancel: () => void
  /** Replaces the form with `latest` and takes its version. Saves nothing. */
  readonly onReload: () => void
  /** Saves `mine` again, on top of `latest`, because a person chose to. */
  readonly onOverwrite: () => void
}

/**
 * What a 409 on save looks like to the person who hit save.
 *
 * The rule this dialog exists for: **never overwrite silently.** Last-write-wins
 * would have taken this operator's text and dropped a colleague's without either
 * of them noticing (DECISIONS 4장). So both versions are put on screen and the
 * choice is made by a person — reload and lose nothing but this edit, or
 * overwrite deliberately, on the version that is actually current.
 *
 * There is no third option that keeps both. Merging two names is not a thing a
 * screen can do on its own, and pretending otherwise would be worse than asking.
 */
export function CategoryConflictDialog({
  open,
  latest,
  mine,
  messages,
  pending,
  onCancel,
  onReload,
  onOverwrite,
}: CategoryConflictDialogProps) {
  const { conflict } = messages

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
        <dd>
          <span className="font-medium">{latest.name}</span>{' '}
          <code className="text-fg-subtle text-xs">{latest.slug}</code>
        </dd>

        <dt className="text-fg-muted">{conflict.mineLabel}</dt>
        <dd>
          <span className="font-medium">{mine.name}</span>{' '}
          <code className="text-fg-subtle text-xs">{mine.slug}</code>
        </dd>
      </dl>
    </Modal>
  )
}
