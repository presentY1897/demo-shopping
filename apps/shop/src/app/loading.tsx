import { Skeleton } from '@shopping/ui/components'
import { PageContainer } from '@shopping/ui/layout'

import { messagesFor } from '@/messages'

/**
 * What fills the main column while the next route is still loading.
 *
 * The header and footer live in the layout above this, so they stay on screen
 * and only the content is replaced — which is what makes a route change read as
 * the page thinking rather than the page disappearing.
 *
 * Paired with the indicator inside the link that was pressed (`NavLink`): this
 * says "something is coming here", that one says "your tap registered". Both
 * matter on a free-tier instance that can take a moment to answer.
 */
export default function Loading() {
  const messages = messagesFor().routeStates

  return (
    <PageContainer className="flex flex-col gap-4 py-6">
      {/* One announcement for the region; the blocks themselves are decorative. */}
      <Skeleton className="w-1/2" label={messages.loadingLabel} shape="text" />
      <Skeleton shape="block" />
      <Skeleton lines={3} shape="text" />
    </PageContainer>
  )
}
