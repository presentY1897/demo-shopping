'use client'

import { Button, ErrorNotice } from '@shopping/ui/components'
import { useState } from 'react'
import { apiFailure } from '@shopping/shared'

import { useAuth } from '@/lib/auth/auth-context'
import { issueDemoAccount } from '@/lib/demo/demo-client'
import type { AuthMessages, DemoMessages } from '@/messages'

/**
 * The control that replaces TASK-0023's blocked placeholder (TASK-0024 4.1).
 *
 * Three states the screen gate P5 asks for, all of them on one button:
 *
 * - **pressed** — the label changes and the button is disabled, so a second
 *   click cannot issue a second account (U3). The API's rate limit is the
 *   backstop; this is what keeps an impatient visitor from meeting it
 * - **failed** — the reason is shown next to the button and the button works
 *   again (U6). A demo that fails silently is indistinguishable from one that
 *   is slow
 * - **issued** — the caller navigates
 *
 * **Issuing and signing in are two calls, and that is the contract.** The
 * response carries only a refresh cookie, so `recheck()` is what turns it into a
 * session — the same renewal every page load already performs.
 */
export function DemoIssueButton({
  messages,
  demo,
  onSignedIn,
}: {
  readonly messages: AuthMessages
  readonly demo: DemoMessages
  readonly onSignedIn: () => void
}) {
  const { recheck } = useAuth()
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function issue(): Promise<void> {
    if (pending) return

    setPending(true)
    setFailure(null)

    try {
      await issueDemoAccount()

      const state = await recheck()

      // The cookie arrived and the renewal still did not produce a session:
      // rare, and the honest thing to say is that it did not work rather than
      // navigating into a console that will bounce them straight back.
      if (state.status !== 'signedIn') {
        setFailure(demo.issueFailed)
        return
      }

      onSignedIn()
    } catch (error) {
      setFailure(reasonFor(error, demo))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        aria-describedby="demo-issue-hint"
        disabled={pending}
        onClick={() => {
          void issue()
        }}
        size="lg"
        variant="outline"
      >
        {pending ? demo.issuePending : messages.signIn.demoLabel}
      </Button>

      <p className="text-fg-muted text-sm" id="demo-issue-hint">
        {messages.signIn.demoReason}
      </p>

      {failure === null ? null : (
        <ErrorNotice description={failure} title={demo.issueFailedTitle} />
      )}
    </div>
  )
}

/**
 * What to tell the visitor.
 *
 * The rate limit is the one refusal with its own sentence, because it is the
 * only one where waiting is the right next action. Everything else — a dead
 * network, a 500, a body we could not read — leaves the same advice, so it gets
 * the same sentence rather than three that say it differently.
 */
function reasonFor(error: unknown, demo: DemoMessages): string {
  const failure = apiFailure(error)

  if (failure.kind === 'transport') return demo.unreachable

  return failure.status === 429 ? demo.rateLimited : demo.issueFailed
}
