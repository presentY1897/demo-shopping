'use client'

/**
 * The one-time explanation of what the density toggle is (TASK-0018 R1).
 *
 * Shown only to a visitor who has never picked a step, and only after mount:
 * the server cannot read localStorage, so rendering this on the server would be
 * a guess, and a guess about markup is a hydration mismatch.
 *
 * It leaves on its own the moment the visitor uses the toggle — the effect
 * re-runs on every density change, and by then a step is stored — so the notice
 * never has to be dismissed by someone who has already understood it.
 *
 * Positioned absolutely under the control so that appearing after paint does not
 * push the page down (CLS).
 */

import { CloseIcon, IconButton } from '@shopping/ui/components'
import { subscribeToDensity } from '@shopping/ui/density'
import { useState, useSyncExternalStore } from 'react'

import { dismissDensityHint, shouldShowDensityHint } from '@/lib/density-hint'
import type { DensityControlMessages } from '@/messages'

export function DensityHint({ messages }: { readonly messages: DensityControlMessages }) {
  // The same hook the density value itself uses, for the same reason: the answer
  // lives in localStorage, which React does not own and the server cannot read.
  // The server snapshot is `false`, so the notice is absent from the markup and
  // appears once on the client — no mismatch, and no `setState` in an effect.
  const owed = useSyncExternalStore(subscribeToDensity, shouldShowDensityHint, notOnTheServer)
  const [dismissed, setDismissed] = useState(false)

  if (!owed || dismissed) return null

  return (
    <div
      className="border-border bg-surface-raised shadow-md absolute top-full right-0 z-40 mt-2 flex w-64 gap-2 rounded-md border p-3"
      role="status"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{messages.hintTitle}</p>
        <p className="text-fg-muted text-xs">{messages.hintBody}</p>
      </div>

      <IconButton
        label={messages.hintDismiss}
        onClick={() => {
          dismissDensityHint()
          setDismissed(true)
        }}
        size="sm"
        variant="ghost"
      >
        <CloseIcon className="size-4" />
      </IconButton>
    </div>
  )
}

/** No localStorage during a server render, so nothing is owed there. */
function notOnTheServer(): boolean {
  return false
}
