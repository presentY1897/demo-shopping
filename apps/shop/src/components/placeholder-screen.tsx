import { Badge } from '@shopping/ui/components'
import { PageContainer } from '@shopping/ui/layout'
import type { ReactNode } from 'react'

import { messagesFor } from '@/messages'

/**
 * A screen whose route exists so the header's links are not dead ends, and whose
 * content belongs to a later milestone (TASK-0018 4.5).
 *
 * Four routes use it — search, category, cart, mypage. Each is replaced whole by
 * the TASK that owns it (0041 · 0042 · M07 · M04), and until then it is the
 * layout's own evidence: the header, the footer and the density toggle are the
 * same on every route because there is only one shell.
 */
export function PlaceholderScreen({
  title,
  body,
  children,
}: {
  readonly title: string
  readonly body: string
  readonly children?: ReactNode
}) {
  const messages = messagesFor().placeholder

  return (
    <PageContainer className="flex flex-col gap-4 py-8">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">{title}</h1>
        <Badge variant="neutral">{messages.comingSoon}</Badge>
      </div>

      <p className="text-fg-muted">{body}</p>

      {children}
    </PageContainer>
  )
}
