'use client'

/**
 * A failure the reader cannot fix, with the number that lets somebody else fix
 * it (TASK-0117 4.4).
 *
 * **Two kinds of failure, two treatments.** A validation error or a conflict is
 * the reader's to resolve, so it goes on the field with a sentence saying what
 * to do — and showing a correlation id beside it would be noise on a screen
 * where the next action is already clear. A 500, a 503 or a dead network is
 * nobody's to resolve from here; the only useful thing the screen can do is hand
 * over a number that leads to the request in the log. That is what this is.
 *
 * **The number has to be quotable, not just visible.** People read UUIDs back
 * over chat and mistype them, so it is selectable monospace text *and* a copy
 * button — the button for the common case, the text for a browser where the
 * clipboard is unavailable (an insecure origin, a denied permission) and for
 * anyone who prefers to select it.
 *
 * `role="alert"` because the thing the reader asked for did not happen and the
 * announcement should interrupt. The copied confirmation is a separate polite
 * live region: it is a response to their own click, not an interruption.
 *
 * No Korean lives here. Every string is a prop, from the app's own catalog
 * (CLAUDE.md 6장) — a component library that shipped sentences would be the one
 * place a product's wording could not be changed without a release.
 */

import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '../components/button'
import { cx } from '../lib/cx'

/** How long the "복사했어요" confirmation stays up. */
const COPIED_FEEDBACK_MS = 2_000

export interface ErrorNoticeProps {
  /** 일시적인 문제가 생겼어요 — from the app's message catalog. */
  readonly title: ReactNode
  readonly description?: ReactNode
  /**
   * The request id, when the reader should be able to quote it.
   *
   * Omitted for a failure they can act on themselves; see the class comment.
   * Omitted, too, when the request never reached the API — there is no id, and
   * inventing one would hand somebody a number that matches nothing.
   */
  readonly requestId?: string
  /** Accessible name of the id, e.g. 문의 번호. Required whenever `requestId` is. */
  readonly requestIdLabel?: string
  /** Why they are being shown a UUID at all. */
  readonly requestIdHint?: ReactNode
  readonly copyLabel?: string
  readonly copiedLabel?: string
  /** Retrying, going back — whatever else this screen can offer. */
  readonly action?: ReactNode
  readonly className?: string
}

/**
 * Copies `text`, answering whether it worked.
 *
 * `navigator.clipboard` is absent on an insecure origin and can reject when the
 * permission is denied, and both have to leave the id on screen rather than
 * showing a confirmation for something that did not happen.
 */
async function copyText(text: string): Promise<boolean> {
  const clipboard: Clipboard | undefined = globalThis.navigator?.clipboard

  if (clipboard === undefined) return false

  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function ErrorNotice({
  title,
  description,
  requestId,
  requestIdLabel,
  requestIdHint,
  copyLabel,
  copiedLabel,
  action,
  className,
}: ErrorNoticeProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A component unmounted while the confirmation is up would otherwise set
  // state on nothing — and, in a test, keep a handle alive past the run.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const copy = useCallback(async (): Promise<void> => {
    if (requestId === undefined || !(await copyText(requestId))) return

    setCopied(true)
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setCopied(false)
    }, COPIED_FEEDBACK_MS)
  }, [requestId])

  return (
    <div
      className={cx(
        'border-danger bg-danger-surface text-fg flex flex-col gap-3 rounded-lg border px-4 py-4',
        className,
      )}
      role="alert"
    >
      <p className="text-base font-medium">{title}</p>
      {description === undefined ? null : <p className="text-fg-muted text-sm">{description}</p>}

      {requestId === undefined ? null : (
        <div className="flex flex-col gap-2">
          {requestIdHint === undefined ? null : (
            <p className="text-fg-muted text-sm">{requestIdHint}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <code
              aria-label={requestIdLabel}
              className="border-border bg-surface text-fg-subtle rounded-md border px-2 py-1 font-mono text-2xs break-all"
            >
              {requestId}
            </code>
            {copyLabel === undefined ? null : (
              <Button
                onClick={() => {
                  void copy()
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {copyLabel}
              </Button>
            )}
          </div>
          {/*
            Polite and always mounted: a live region added to the DOM at the
            moment its text changes is announced inconsistently, and a status
            that only exists while it has something to say is exactly that.
          */}
          <p aria-live="polite" className="text-fg-muted text-2xs" role="status">
            {copied ? copiedLabel : ''}
          </p>
        </div>
      )}

      {action}
    </div>
  )
}
