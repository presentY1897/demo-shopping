'use client'

import { ToastProvider } from '@shopping/ui/components'

import type { CategoryMessages } from '@/messages'

import { CategoryWorkspace } from './category-workspace'

interface CategoryManagerProps {
  readonly messages: CategoryMessages
}

/**
 * The client boundary for `/categories`.
 *
 * It carries the toast provider and nothing else. The page above it stays a
 * server component that awaits nothing, so the console's markup is produced
 * whether or not the API is awake (TASK-0101 4.3) — the tree arrives afterwards,
 * through the four states `CategoryWorkspace` draws.
 */
export function CategoryManager({ messages }: CategoryManagerProps) {
  return (
    <ToastProvider closeLabel={messages.toast.closeLabel} regionLabel={messages.toast.regionLabel}>
      <CategoryWorkspace messages={messages} />
    </ToastProvider>
  )
}
