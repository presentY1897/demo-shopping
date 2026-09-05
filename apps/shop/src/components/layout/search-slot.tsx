'use client'

/**
 * The header's search field.
 *
 * TASK-0018 asked for the slot and left the destination empty; TASK-0041 fills
 * it in, and the whole of the change is that the field now suggests. It is still
 * a `GET /search`, still submits before hydration, and still works with the
 * keyboard alone — see {@link SearchBox} for why the suggestions are built on
 * top of a form rather than in place of one.
 */

import { SearchBox } from '@/components/search/search-box'
import type { SearchSlotMessages } from '@/messages'

export function SearchSlot({
  className,
  messages,
}: {
  readonly className?: string
  readonly messages: SearchSlotMessages
}) {
  return <SearchBox className={className} messages={messages} />
}
