'use client'

import { Button, Modal, ModalClose } from '@shopping/ui/components'

import type { CategoryRow } from '@/lib/categories/tree'
import type { CategoryMessages } from '@/messages'

/**
 * Which of the three retirement questions is being asked.
 *
 * `remove-blocked` is a state, not an error: the tree already knows the category
 * has children, so the console says so before the API is asked rather than
 * sending a request it knows will be refused (TASK-0029 4장, 화면 겹).
 */
export type RetireIntent = 'remove' | 'remove-blocked' | 'deactivate' | 'activate'

interface CategoryRetireDialogProps {
  readonly open: boolean
  readonly intent: RetireIntent
  readonly category: CategoryRow
  readonly messages: CategoryMessages
  readonly pending: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
  /** Offered when a delete is refused — the operator still gets somewhere. */
  readonly onDeactivateInstead: () => void
}

export function CategoryRetireDialog({
  open,
  intent,
  category,
  messages,
  pending,
  onCancel,
  onConfirm,
  onDeactivateInstead,
}: CategoryRetireDialogProps) {
  const { retire } = messages

  const copy = {
    remove: { title: retire.removeTitle, description: retire.removeDescription },
    'remove-blocked': {
      title: retire.removeBlockedTitle,
      description: retire.removeBlockedDescription,
    },
    deactivate: { title: retire.deactivateTitle, description: retire.deactivateDescription },
    activate: { title: retire.activateTitle, description: retire.activateDescription },
  }[intent]

  const confirmLabel = {
    remove: retire.confirmRemove,
    'remove-blocked': retire.confirmDeactivate,
    deactivate: retire.confirmDeactivate,
    activate: retire.confirmActivate,
  }[intent]

  return (
    <Modal
      closeLabel={retire.closeLabel}
      description={copy.description}
      footer={
        <>
          <ModalClose>
            <Button variant="ghost">{retire.cancel}</Button>
          </ModalClose>
          <Button
            loading={pending}
            onClick={intent === 'remove-blocked' ? onDeactivateInstead : onConfirm}
            variant={intent === 'remove' ? 'danger' : 'primary'}
          >
            {confirmLabel}
          </Button>
        </>
      }
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      open={open}
      size="sm"
      title={copy.title}
    >
      <p className="text-sm">
        <span className="font-medium">{category.name}</span>{' '}
        <code className="text-fg-subtle text-xs">{category.slug}</code>
      </p>
    </Modal>
  )
}
