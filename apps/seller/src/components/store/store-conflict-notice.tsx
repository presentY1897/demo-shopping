'use client'

import { Button } from '@shopping/ui/components'

import type { StoreConflictMessages } from '@/messages'

/**
 * What a 409 on save looks like to the person who pressed 저장 (TASK-0109 F6).
 *
 * **Nothing is overwritten and nothing is thrown away.** Last-write-wins would
 * take this seller's text and silently drop the one that got there first
 * (DECISIONS 4장), and reloading on their behalf would take the paragraph they
 * just typed. So both stay: the form keeps what they wrote, and the choice —
 * take the stored version, or write over it deliberately — is a person's.
 *
 * **An inline region rather than a modal.** The admin console shows a conflict
 * in a dialog because it has to put two rows side by side; here there is one
 * store and it is already on screen, so the only thing a dialog would add is a
 * focus trap and a portal — the second of which every axe run then has to be
 * told to ignore.
 *
 * `role="alert"` is right here, unlike the status banner: this is the answer to
 * a button somebody just pressed, it appears at most once per submit, and the
 * next thing they do depends on knowing about it.
 */
export function StoreConflictNotice({
  messages,
  pending,
  onReload,
  onOverwrite,
}: {
  readonly messages: StoreConflictMessages
  /** A retry is in flight. Blocks a second one without leaving the tab order. */
  readonly pending: boolean
  /** Replaces the form with what the server holds. Saves nothing. */
  readonly onReload: () => void
  /** Saves what is typed, on top of the version that is actually current. */
  readonly onOverwrite: () => void
}) {
  return (
    <div
      className="border-warning bg-warning-surface text-fg flex flex-col gap-3 rounded-lg border px-4 py-4"
      role="alert"
    >
      <p className="text-base font-medium">{messages.title}</p>
      <p className="text-sm">{messages.body}</p>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onReload} variant="primary">
          {messages.reloadLabel}
        </Button>
        <Button loading={pending} onClick={onOverwrite} variant="outline">
          {messages.overwriteLabel}
        </Button>
      </div>
    </div>
  )
}
