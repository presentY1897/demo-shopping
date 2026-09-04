'use client'

/**
 * The top bar's two reserved slots — notifications and the account menu.
 *
 * Neither exists yet: the notification centre is M11 and sign-in is M04. They
 * are still working controls rather than disabled buttons, because a control
 * that cannot be pressed is a dead end for a keyboard user and a puzzle for
 * everyone else (TASK-0018 4.5). Pressing one opens a popover that says which
 * milestone fills it.
 *
 * Both are the same shape, so they are one component used twice. When M04 and
 * M11 arrive they replace their call site, not this file.
 */

import { IconButton, Popover } from '@shopping/ui/components'
import type { ReactNode } from 'react'

import type { ConsoleSlotMessages } from '@/messages'

export function ConsoleSlot({
  messages,
  children,
}: {
  readonly messages: ConsoleSlotMessages
  readonly children: ReactNode
}) {
  return (
    <Popover
      align="end"
      closeLabel={messages.closeLabel}
      title={messages.title}
      trigger={
        <IconButton label={messages.label} size="sm" variant="ghost">
          {children}
        </IconButton>
      }
    >
      <p className="text-fg-muted">{messages.body}</p>
    </Popover>
  )
}
