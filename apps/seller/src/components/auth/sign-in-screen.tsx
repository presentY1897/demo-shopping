'use client'

import type { OauthResult } from '@shopping/shared'
import { parseOauthResult } from '@shopping/shared'
import { Button, buttonClassName, ErrorNotice } from '@shopping/ui/components'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { DemoIssueButton } from '@/components/demo/demo-issue-button'
import { useAuth } from '@/lib/auth/auth-context'
import {
  HOME_PATH,
  NEXT_PARAM,
  rememberNextPath,
  safeNextPath,
  takeNextPath,
} from '@/lib/auth/next-path'
import { googleSignInHref } from '@/lib/auth/sign-in'
import type { AuthMessages, DemoMessages } from '@/messages'

/**
 * The sign-in screen, and the four things it can be told (TASK-0023 4장).
 *
 * | it arrived with | what is shown |
 * | --- | --- |
 * | nothing | the sign-in buttons |
 * | `status=ok` | nothing for long — the effect below leaves for `next` |
 * | `status=cancelled` | the buttons, plus "취소했습니다". Not an error |
 * | `status=error&reason` | the buttons, plus the sentence for that reason |
 *
 * A fifth case is the reason `parseOauthResult` returns `null` rather than
 * throwing: a query string that was mangled in transit. The screen still works —
 * it says the generic sentence and offers the buttons again — because the
 * alternative is a dead end at the exact moment somebody is trying to get in.
 *
 * **`status` is checked before the result is read.** An ordinary visit to
 * `/login` carries no query at all and also parses to `null`, and treating that
 * as a mangled round trip would greet every visitor with an error.
 */
export function SignInScreen({
  messages,
  demo,
}: {
  readonly messages: AuthMessages
  readonly demo: DemoMessages
}) {
  const params = useSearchParams()
  const router = useRouter()
  const { state } = useAuth()

  const roundTrip = params.has('status')
  const result = roundTrip ? parseOauthResult(new URLSearchParams(params.toString())) : null
  const asked = safeNextPath(params.get(NEXT_PARAM))
  const succeeded = result?.status === 'ok'

  // The address bar first, then what this tab remembered before leaving for
  // Google — the round trip cannot carry a parameter of ours (see `next-path`).
  const [next] = useState(() =>
    roundTrip ? (asked ?? takeNextPath() ?? HOME_PATH) : (asked ?? HOME_PATH),
  )

  useEffect(() => {
    // Stored on arrival rather than on click, so a middle-click, a keyboard
    // activation and a reload all remember the same thing.
    if (!roundTrip && asked !== null) rememberNextPath(asked)
  }, [roundTrip, asked])

  useEffect(() => {
    // Only after a real round trip. Somebody who opened `/login` while already
    // signed in asked to be here, and bouncing them away would make the account
    // menu's own link useless.
    if (!succeeded || state.status !== 'signedIn') return

    router.replace(next)
  }, [succeeded, state.status, next, router])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{messages.signIn.title}</h1>
        <p className="text-fg-muted text-sm">{messages.signIn.description}</p>
      </div>

      <SignInOutcome messages={messages} result={result} roundTrip={roundTrip} />
      <SessionNotice messages={messages} />

      {state.status === 'signedIn' && !succeeded ? (
        <SignedIn messages={messages} onContinue={() => router.push(next)} />
      ) : (
        <SignInActions
          demo={demo}
          messages={messages}
          onSignedIn={() => {
            router.replace(next)
          }}
        />
      )}
    </div>
  )
}

/** What the callback said, if it said anything. */
function SignInOutcome({
  messages,
  result,
  roundTrip,
}: {
  readonly messages: AuthMessages
  readonly result: OauthResult | null
  readonly roundTrip: boolean
}) {
  if (!roundTrip) return null

  const { outcome } = messages

  if (result === null) return <Notice title={outcome.failureTitle} body={outcome.generic} />
  if (result.status === 'cancelled') return <Notice body={outcome.cancelled} />
  if (result.status === 'error') {
    const body = result.reason === undefined ? outcome.generic : outcome.failures[result.reason]

    return <Notice title={outcome.failureTitle} body={body} />
  }
  if (result.notice !== undefined) return <Notice body={outcome.notices[result.notice]} />

  return null
}

/**
 * Why the session this browser had stopped working.
 *
 * Only the two reasons a person can act on. `unknown` and `expired` are the
 * ordinary state of a browser that is simply not signed in, and announcing them
 * would put an error on the screen of every first-time visitor.
 */
function SessionNotice({ messages }: { readonly messages: AuthMessages }) {
  const { state } = useAuth()

  if (state.status !== 'anonymous' || state.refusal === null) return null
  if (state.refusal !== 'reused' && state.refusal !== 'unreachable') return null

  return (
    <Notice title={messages.outcome.failureTitle} body={messages.outcome.sessions[state.refusal]} />
  )
}

function Notice({ title, body }: { readonly title?: string; readonly body: string }) {
  return title === undefined ? (
    <p className="text-fg-muted text-sm" role="status">
      {body}
    </p>
  ) : (
    <ErrorNotice description={body} title={title} />
  )
}

function SignedIn({
  messages,
  onContinue,
}: {
  readonly messages: AuthMessages
  readonly onContinue: () => void
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="font-medium">{messages.signIn.signedInTitle}</p>
      <p className="text-fg-muted text-sm">{messages.signIn.signedInBody}</p>
      <Button onClick={onContinue}>{messages.signIn.continueLabel}</Button>
    </div>
  )
}

/**
 * The buttons.
 *
 * Google is an `<a>`, not a `<button>`: the endpoint answers 302 to a consent
 * screen, so the *browser* has to make the trip. The demo entry **is** a button,
 * because it is one `fetch` and a renewal and the visitor never leaves this page
 * — TASK-0023 left a blocked `GuardedButton` here and TASK-0024 replaced it.
 *
 * A configuration failure hides both: neither can work without an API address,
 * and offering one of them would be offering a button that throws.
 */
function SignInActions({
  messages,
  demo,
  onSignedIn,
}: {
  readonly messages: AuthMessages
  readonly demo: DemoMessages
  readonly onSignedIn: () => void
}) {
  const href = signInUrl()

  if (href === null) {
    return (
      <ErrorNotice
        description={messages.signIn.configurationBody}
        title={messages.signIn.configurationTitle}
      />
    )
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <a className={buttonClassName({ size: 'lg' })} href={href}>
        {messages.signIn.googleLabel}
      </a>

      <DemoIssueButton demo={demo} messages={messages} onSignedIn={onSignedIn} />
    </div>
  )
}

/**
 * The authorize URL.
 *
 * `null` when this deployment has no API address, which is a configuration
 * failure rather than a sign-in failure and is reported as one. Nothing of ours
 * is appended to it: the endpoint declares `?app=` and zod strips the rest.
 */
function signInUrl(): string | null {
  try {
    return googleSignInHref()
  } catch {
    return null
  }
}
