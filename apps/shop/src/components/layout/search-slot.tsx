'use client'

/**
 * The search field — a real form, an empty destination.
 *
 * TASK-0018 scopes search out (M06 owns it) and asks for the slot. The slot is
 * a working `GET /search`: a disabled input would be a dead control in the
 * middle of the header, and the submit path is the part the layout is
 * responsible for either way. TASK-0041 replaces the destination.
 *
 * `next/form` rather than a bare `<form>` so submitting navigates on the client
 * — the same route transition as a link, with the same loading treatment —
 * instead of reloading the document.
 */

import { Button, Input } from '@shopping/ui/components'
import Form from 'next/form'

import type { SearchSlotMessages } from '@/messages'

export function SearchSlot({
  className,
  messages,
}: {
  readonly className?: string
  readonly messages: SearchSlotMessages
}) {
  return (
    <Form action="/search" className={className} role="search">
      <div className="flex w-full items-center gap-2">
        <Input
          aria-label={messages.label}
          className="min-w-0 flex-1"
          name="q"
          placeholder={messages.placeholder}
          type="search"
        />
        <Button type="submit" variant="secondary">
          {messages.submit}
        </Button>
      </div>
    </Form>
  )
}
