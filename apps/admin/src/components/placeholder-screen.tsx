import { Badge } from '@shopping/ui/components'
import { PageHeader } from '@shopping/ui/console'

import { messagesFor } from '@/messages'

/**
 * A screen whose route exists so the sidebar has no dead ends, and whose
 * content belongs to a later milestone (TASK-0019 4.10).
 *
 * It is also the layout's own evidence: every menu entry leads somewhere, the
 * shell is identical on all of them, and the entry that led here is the one
 * that is lit. Neither the sub-route highlight (F2) nor the keyboard sweep (F5)
 * can be measured without real routes.
 *
 * The TASK that owns each screen replaces its `page.tsx` whole.
 */
export function PlaceholderScreen({ title }: { readonly title: string }) {
  const messages = messagesFor().placeholder

  return (
    <PageHeader
      actions={<Badge variant="neutral">{messages.comingSoon}</Badge>}
      description={messages.body}
      title={title}
    />
  )
}
