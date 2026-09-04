'use client'

import { ToastProvider } from '@shopping/ui/components'

import type { ErrorMessages } from '@/lib/errors'
import type { AttributeMessages, ErrorNoticeMessages } from '@/messages'

import { AttributeWorkspace } from './attribute-workspace'

interface AttributeManagerProps {
  readonly messages: AttributeMessages
  /**
   * `code` → sentence, for every failure the API can answer with.
   *
   * A second slice rather than the whole catalog: the boundary below is a client
   * component, so everything passed here is serialised into the page.
   */
  readonly errors: ErrorMessages
  readonly notice: ErrorNoticeMessages
}

/**
 * The client boundary for `/attributes`.
 *
 * It carries the toast provider and nothing else. The page above it stays a
 * server component that awaits nothing, so the console's markup is produced
 * whether or not the API is awake (TASK-0101 4.3) — the definitions arrive
 * afterwards, through the four states `AttributeWorkspace` draws.
 */
export function AttributeManager({ messages, errors, notice }: AttributeManagerProps) {
  return (
    <ToastProvider closeLabel={messages.toast.closeLabel} regionLabel={messages.toast.regionLabel}>
      <AttributeWorkspace errors={errors} messages={messages} notice={notice} />
    </ToastProvider>
  )
}
