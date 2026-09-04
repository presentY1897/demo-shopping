'use client'

import { Button, buttonClassName, EmptyState } from '@shopping/ui/components'
import Link from 'next/link'
import { useState } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import { LOGIN_ROUTE } from '@/lib/auth/console-access'
import type { AuthMessages } from '@/messages'

/**
 * "Signed in, and still nothing here" — with the two ways out.
 *
 * The ways out matter more than the sentence. Somebody who signed in with the
 * wrong Google account is one click from the right one, and somebody who has to
 * come back later should not have a live session sitting in this browser. A
 * refusal screen with no action is where a demo visitor stops.
 *
 * `role="status"` comes from `EmptyState`, which is the right politeness here:
 * the page is the answer to a navigation the person made, not an interruption.
 */
export function NoPermissionScreen({ messages }: { readonly messages: AuthMessages }) {
  const { state, signOut } = useAuth()
  const [busy, setBusy] = useState(false)

  return (
    <EmptyState
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link className={buttonClassName({ size: 'sm', variant: 'outline' })} href={LOGIN_ROUTE}>
            {messages.guard.signInLabel}
          </Link>

          {state.status === 'signedIn' ? (
            <Button
              loading={busy}
              onClick={() => {
                setBusy(true)
                void signOut().finally(() => {
                  setBusy(false)
                })
              }}
              size="sm"
              variant="ghost"
            >
              {messages.guard.signOutLabel}
            </Button>
          ) : null}
        </div>
      }
      description={
        <>
          {messages.guard.body}
          {/*
            Said out loud rather than implied by an empty screen: the states this
            console cannot yet tell apart are a known gap with an owner
            (TASK-0108 · TASK-0109), not a bug the reader should report.
          */}
          <span className="text-fg-subtle mt-2 block text-xs">{messages.guard.pendingNote}</span>
        </>
      }
      title={messages.guard.title}
    />
  )
}
