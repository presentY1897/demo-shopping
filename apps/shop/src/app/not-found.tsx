import { EmptyState, Link } from '@shopping/ui/components'
import { PageContainer } from '@shopping/ui/layout'

import { messagesFor } from '@/messages'

/**
 * 404, inside the shell.
 *
 * Rendered by the root layout like any other screen, so a wrong address still
 * has the header, the search field and the density toggle — the things that let
 * a visitor recover without pressing back.
 */
export default function NotFound() {
  const messages = messagesFor().routeStates

  return (
    <PageContainer className="py-12">
      <EmptyState
        action={<Link href="/">{messages.homeLabel}</Link>}
        description={messages.notFoundBody}
        title={messages.notFoundTitle}
      />
    </PageContainer>
  )
}
