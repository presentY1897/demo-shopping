import type { WakeMessages } from '@/messages'
import type { WakePolicy } from '@/lib/wake-policy'
import { elapsedSeconds, wakeNoticeLevel, wakeProgress } from '@/lib/wake-policy'

interface WakeWaitingProps {
  /** Reuses the panel's own heading so the section does not move when data lands. */
  readonly title: string
  readonly messages: WakeMessages
  readonly policy: WakePolicy
  readonly elapsedMs: number
  readonly attempt: number
  readonly attempts: number
}

/**
 * The skeleton, and — once the wait stops being ordinary — why it is happening.
 *
 * Three things are on screen at 3 seconds rather than one: the sentence, a
 * moving elapsed counter and a progress bar. A single static line is what makes
 * the remaining 87 seconds of a cold start read as a frozen page, and a frozen
 * page gets reloaded — which throws away the spin-up already in progress and
 * starts the 90 seconds over (TASK-0101 4.2).
 */
export function WakeWaiting({
  title,
  messages,
  policy,
  elapsedMs,
  attempt,
  attempts,
}: WakeWaitingProps) {
  const level = wakeNoticeLevel(policy, elapsedMs)
  const percent = wakeProgress(policy, elapsedMs)

  return (
    // Named by its own heading, so the busy region is one thing a screen reader
    // (and a test) can address rather than an anonymous box.
    <section
      aria-busy="true"
      aria-labelledby={HEADING_ID}
      className="border-border rounded-lg border p-6"
    >
      <h2 className="text-lg font-semibold" id={HEADING_ID}>
        {title}
      </h2>

      {/*
        Announced from the first frame, so a screen reader is told the panel is
        loading without waiting for the 3 second threshold to pass.
      */}
      <p className="sr-only" role="status">
        {messages.loadingLabel}
      </p>

      <ul aria-hidden="true" className="mt-4 flex flex-col gap-1">
        {SKELETON_ROWS.map((row) => (
          <li key={row} className="border-border min-h-touch flex items-center gap-3 border-b">
            <span className="bg-surface-muted size-2.5 animate-pulse rounded-full" />
            <span className="bg-surface-muted h-4 w-1/3 animate-pulse rounded" />
          </li>
        ))}
      </ul>

      {level === 'none' ? null : (
        <div className="mt-6 flex flex-col gap-2">
          {/*
            Only the sentences are a live region. The counter below changes four
            times a second, and announcing that would make the page unusable with
            a screen reader; the progress bar carries the same information for
            anyone who asks for it.
          */}
          <div role="status">
            <p className="font-medium">{messages.preparing}</p>
            <p className="text-fg-muted mt-1 text-sm">{messages.preparingHint}</p>
            {level === 'cold' ? (
              <p className="text-fg-muted mt-1 text-sm">{messages.coldStartNotice}</p>
            ) : null}
          </div>

          <div
            aria-label={messages.progressLabel}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={percent}
            className="bg-surface-muted h-2 w-full overflow-hidden rounded-full"
            role="progressbar"
          >
            <div
              className="bg-primary h-full rounded-full transition-all"
              style={{ width: `${String(percent)}%` }}
            />
          </div>

          <p className="text-fg-subtle text-sm">
            {messages.elapsedLabel} {elapsedSeconds(elapsedMs)}
            {messages.secondsUnit} · {messages.attemptLabel} {attempt}/{attempts}
          </p>
        </div>
      )}
    </section>
  )
}

/** Three rows: the payload has three liveness fields, so nothing jumps. */
const SKELETON_ROWS = [0, 1, 2]

/** Constant rather than `useId`: only one waiting panel is ever on screen. */
const HEADING_ID = 'api-wake-heading'
