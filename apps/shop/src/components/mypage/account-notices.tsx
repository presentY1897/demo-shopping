'use client'

import { ErrorNotice, ErrorState, Skeleton } from '@shopping/ui/components'

import type { ApiFailure } from '@/lib/api-failure'
import { failureMessage, quotableRequestId } from '@/lib/api-failure'
import type { MyPageMessages } from '@/messages'

/**
 * The three things both account screens say when something is not the happy
 * path: "still loading", "it did not load", "that did not save".
 *
 * One file rather than a copy in each screen, because the *rules* are the ones
 * TASK-0117 settled and they are easy to get subtly wrong twice:
 *
 * - the catalog's sentence first, the server's own only when this app has no
 *   word for the code (`failureMessage`);
 * - a request id **only** for a failure the reader cannot act on, and only when
 *   there is one (`quotableRequestId`) — a UUID beside "우편번호를 5자리로"
 *   suggests the problem is ours when it is not;
 * - a failed load is an `alert`, because what was asked for never arrived; a
 *   skeleton is a `status`, because it is a wait rather than an interruption.
 */

/** The wait. Shaped like the rows that are coming, and named for a reader who cannot see it. */
export function AccountLoading({
  label,
  rows = 3,
}: {
  readonly label: string
  readonly rows?: number
}) {
  return (
    <div aria-busy="true" aria-label={label} className="flex flex-col gap-4" role="status">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton className="h-24 w-full" key={index} />
      ))}
    </div>
  )
}

/** The read failed, so there is nothing on screen and retrying is the next step. */
export function AccountLoadFailure({
  failure,
  messages,
  onRetry,
}: {
  readonly failure: ApiFailure
  readonly messages: MyPageMessages
  readonly onRetry: () => void
}) {
  const requestId = quotableRequestId(failure)

  return (
    <ErrorState
      description={failureMessage(failure, messages)}
      detail={requestId === null ? undefined : `${messages.requestIdLabel}: ${requestId}`}
      onRetry={onRetry}
      retryLabel={messages.retryLabel}
      title={messages.loadErrorTitle}
    />
  )
}

/**
 * A write failed, and the screen around it is still perfectly good.
 *
 * `ErrorNotice` rather than `ErrorState`: the reader has their typed values in
 * front of them and the thing to do is try again, not reload the screen. That
 * is also U6 — the input must survive the failure, and it does because nothing
 * here resets a form.
 */
export function AccountWriteFailure({
  failure,
  messages,
  title,
}: {
  readonly failure: ApiFailure
  readonly messages: MyPageMessages
  readonly title: string
}) {
  const requestId = quotableRequestId(failure)

  return (
    <ErrorNotice
      copiedLabel={messages.copiedLabel}
      copyLabel={messages.copyLabel}
      description={failureMessage(failure, messages)}
      requestId={requestId ?? undefined}
      requestIdHint={requestId === null ? undefined : messages.requestIdHint}
      requestIdLabel={requestId === null ? undefined : messages.requestIdLabel}
      title={title}
    />
  )
}

/**
 * "Saved." — polite, because nobody has to stop what they are doing for it.
 *
 * Kept as a live region rather than a toast: a toast would need a provider in
 * the shell for the two screens that use one, and a message that leaves after
 * four seconds is a message a slow reader never sees.
 */
export function AccountNotice({ children }: { readonly children: string }) {
  return (
    <p className="text-fg-muted text-sm" role="status">
      {children}
    </p>
  )
}
