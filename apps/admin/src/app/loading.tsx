import { Skeleton } from '@shopping/ui/components'

import { messagesFor } from '@/messages'

/**
 * What fills the content column while the next screen is still loading.
 *
 * The sidebar and the top bar live in the layout above this, so they stay put
 * and only the content is replaced — which is what makes moving between console
 * screens read as the page thinking rather than the console disappearing.
 */
export default function Loading() {
  const messages = messagesFor().routeStates

  return (
    <div className="flex flex-col gap-4">
      {/* One announcement for the region; the blocks themselves are decorative. */}
      <Skeleton className="w-1/3" label={messages.loadingLabel} shape="text" />
      <Skeleton shape="block" />
      <Skeleton lines={3} shape="text" />
    </div>
  )
}
