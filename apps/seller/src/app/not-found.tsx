import { EmptyState, Link } from '@shopping/ui/components'

import { messagesFor } from '@/messages'

/**
 * 404, inside the shell.
 *
 * Rendered by the root layout like any other screen, so a wrong address still
 * has the sidebar — the thing that lets an operator get somewhere real without
 * pressing back.
 */
export default function NotFound() {
  const messages = messagesFor().routeStates

  return (
    <EmptyState
      action={<Link href="/">{messages.homeLabel}</Link>}
      description={messages.notFoundBody}
      title={messages.notFoundTitle}
    />
  )
}
