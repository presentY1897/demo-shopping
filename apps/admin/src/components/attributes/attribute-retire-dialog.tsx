'use client'

import type { EffectiveAttribute } from '@shopping/shared'
import { Button, Modal, ModalClose } from '@shopping/ui/components'

import type { AttributeMessages } from '@/messages'

/**
 * Which question is being asked about a definition on its way out.
 *
 * `blocked` is not a second dialog: a refused delete turns *this* one into the
 * explanation rather than closing and leaving a toast behind, which is the shape
 * TASK-0029 settled on for a category that still has children.
 *
 * **`blocked` is unreachable today, on purpose.** The API cannot answer whether
 * a definition is in use — `Product` arrives with TASK-0032, and so does the
 * check (TASK-0030 R2). The branch exists so that adding the code is adding a
 * sentence, not rebuilding a flow (TASK-0031 4.7).
 */
export type RetireIntent = 'remove' | 'blocked'

interface AttributeRetireDialogProps {
  readonly open: boolean
  readonly intent: RetireIntent
  readonly attribute: EffectiveAttribute
  readonly messages: AttributeMessages
  readonly pending: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

export function AttributeRetireDialog({
  open,
  intent,
  attribute,
  messages,
  pending,
  onCancel,
  onConfirm,
}: AttributeRetireDialogProps) {
  const { retire } = messages
  const blocked = intent === 'blocked'

  return (
    <Modal
      closeLabel={retire.closeLabel}
      description={blocked ? retire.blockedDescription : retire.description}
      footer={
        <>
          <ModalClose>
            <Button variant="ghost">{retire.cancel}</Button>
          </ModalClose>
          {blocked ? null : (
            <Button loading={pending} onClick={onConfirm} variant="danger">
              {retire.confirm}
            </Button>
          )}
        </>
      }
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      open={open}
      size="sm"
      title={blocked ? retire.blockedTitle : retire.title}
    >
      <p className="text-sm">
        <span className="font-medium">{attribute.label}</span>{' '}
        <code className="text-fg-subtle text-xs">{attribute.key}</code>
      </p>
    </Modal>
  )
}
