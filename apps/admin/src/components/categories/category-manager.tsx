'use client'

import { ToastProvider } from '@shopping/ui/components'
import type { ErrorMessages } from '@shopping/shared'

import type { CategoryMessages, ErrorNoticeMessages } from '@/messages'

import { CategoryWorkspace } from './category-workspace'

interface CategoryManagerProps {
  readonly messages: CategoryMessages
  /**
   * `code` → sentence, for every failure the API can answer with.
   *
   * A second slice rather than the whole catalog: the boundary below is a client
   * component, so everything passed here is serialised into the page. The
   * console needs the error copy and the category copy, and nothing else.
   */
  readonly errors: ErrorMessages
  readonly notice: ErrorNoticeMessages
}

/**
 * The client boundary for `/categories`.
 *
 * It carries the toast provider and nothing else. The page above it stays a
 * server component that awaits nothing, so the console's markup is produced
 * whether or not the API is awake (TASK-0101 4.3) — the tree arrives afterwards,
 * through the four states `CategoryWorkspace` draws.
 */
export function CategoryManager({ messages, errors, notice }: CategoryManagerProps) {
  return (
    <ToastProvider closeLabel={messages.toast.closeLabel} regionLabel={messages.toast.regionLabel}>
      <CategoryWorkspace errors={errors} messages={messages} notice={notice} />
    </ToastProvider>
  )
}
