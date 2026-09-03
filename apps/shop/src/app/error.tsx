'use client'

import { ErrorState } from '@shopping/ui/components'
import { PageContainer } from '@shopping/ui/layout'

import { messagesFor } from '@/messages'

/**
 * The route-level error boundary (P5).
 *
 * Next requires this to be a client component: `reset` re-renders the segment in
 * place, which is a browser-side operation, and it is the difference between an
 * error a visitor can retry and one that needs a reload.
 *
 * The message is deliberately generic. `error.digest` identifies the failure in
 * the server logs; the text on screen says what the visitor can do about it,
 * which is the only part they can act on.
 */
export default function RouteError({
  reset,
}: {
  readonly error: Error
  readonly reset: () => void
}) {
  const messages = messagesFor().routeStates

  return (
    <PageContainer className="py-12">
      <ErrorState
        description={messages.errorBody}
        onRetry={reset}
        retryLabel={messages.retryLabel}
        title={messages.errorTitle}
      />
    </PageContainer>
  )
}
