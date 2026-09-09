import { Button } from '@shopping/ui/components'

import type { WakeMessages } from '@/messages'

interface WakeFailureProps {
  readonly messages: WakeMessages
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
 *
 * **The attempt count used to be printed here** ("시도 3/3"). It went with the
 * policy that had a fixed number of attempts: the budget is wall-clock now, so
 * there is no total to count towards, and the number on its own told the visitor
 * nothing they could act on (TASK-0118 4.7).
 */
export function WakeFailure({ messages, onRetry }: WakeFailureProps) {
  return (
    <div className="border-border rounded-lg border p-6">
      <p className="font-medium">{messages.failureTitle}</p>
      <p className="text-fg-muted mt-1 text-sm">{messages.failureHint}</p>
      <Button className="mt-4" onClick={onRetry} variant="primary">
        {messages.retryLabel}
      </Button>
    </div>
  )
}
