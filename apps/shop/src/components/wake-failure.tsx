import { Button } from '@shopping/ui/components'

import type { WakeMessages } from '@/messages'

interface WakeFailureProps {
  readonly messages: WakeMessages
  readonly attempts: number
  readonly onRetry: () => void
}

/**
 * Shown under the panel once the retry budget is spent.
 *
 * The panel above already says *what* failed (U6); this says what the app did
 * about it and hands the next move back to the visitor. The button is a real
 * `<button>` from `@shopping/ui`, so Tab reaches it and Enter and Space work
 * (U5) without this file arranging any of that.
 *
 * The app also retries on its own when the network returns or the tab comes
 * forward — see `useApiWake`. This button is for the case where neither happens.
 */
export function WakeFailure({ messages, attempts, onRetry }: WakeFailureProps) {
  return (
    <div className="border-border rounded-lg border p-6">
      <p className="font-medium">{messages.failureTitle}</p>
      <p className="text-fg-muted mt-1 text-sm">{messages.failureHint}</p>
      <p className="text-fg-subtle mt-1 text-sm">
        {messages.attemptLabel} {attempts}/{attempts}
      </p>

      <Button className="mt-4" onClick={onRetry} variant="primary">
        {messages.retryLabel}
      </Button>
    </div>
  )
}
