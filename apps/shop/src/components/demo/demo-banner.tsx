'use client'

import type { DemoAccount } from '@shopping/shared'
import { useEffect, useState } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import { readDemoAccount } from '@/lib/demo/demo-client'
import { fill, remainingOf } from '@/lib/demo/remaining'
import type { DemoMessages } from '@/messages'

/** How often the sentence is recomputed. Minutes are the unit it shows. */
const TICK_MS = 60_000

/**
 * Where the banner is placed decides how it is drawn.
 *
 * `strip` is the storefront: the banner sits above a sticky header, in the page's
 * own chrome, and a full-bleed bar reads as part of it.
 *
 * `card` is a console. The shell's sidebar is `fixed` from the top of the
 * viewport, so **anything rendered above the shell is covered by it** — found by
 * opening the console (TASK-0024 9장). The banner therefore goes inside `main`,
 * where a bordered card is the shape the rest of that column already uses.
 */
const SHAPE = {
  strip: 'border-b',
  card: 'rounded-md border',
} as const

export type DemoBannerVariant = keyof typeof SHAPE

/**
 * How long this demo has left, on every page (TASK-0024 4.6 · F5).
 *
 * **It asks the API rather than reading the session.** The banner has to survive
 * a reload, and all a reload gives an app is `POST /auth/refresh` — whose
 * response is TASK-0022's contract and deliberately knows nothing about demos
 * (4.2). So the answer comes from `GET /auth/demo`, once per boot, and a real
 * account gets `null` and draws nothing.
 *
 * **`role="status"`, not `role="alert"`.** This is a state that is true for
 * twenty-four hours, not an answer to something the visitor just did; an alert
 * would interrupt a screen reader on every page.
 *
 * **A failed lookup draws nothing.** The banner is an aid, and an error message
 * where a countdown should be is worse than no countdown — the visitor cannot
 * act on it and the console behind it works perfectly.
 */
export function DemoBanner({
  messages,
  variant = 'strip',
}: {
  readonly messages: DemoMessages
  readonly variant?: DemoBannerVariant
}) {
  const { state } = useAuth()
  const userId = state.status === 'signedIn' ? state.user.id : null

  /**
   * What the API said, and **who it was said about**.
   *
   * The account id travels with the answer instead of the effect clearing the
   * state when somebody signs out. Two reasons, and only the first is a lint
   * rule: a `setState` in the body of an effect is a second render nobody asked
   * for, and — the one that matters — an answer that arrives after a sign-out
   * would otherwise be shown to whoever is signed in *now*.
   */
  const [loaded, setLoaded] = useState<{
    readonly userId: string
    readonly account: DemoAccount | null
  } | null>(null)

  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    if (userId === null) return

    let live = true

    void readDemoAccount().then(
      (found) => {
        if (live) setLoaded({ userId, account: found })
      },
      () => {
        if (live) setLoaded({ userId, account: null })
      },
    )

    return () => {
      live = false
    }
  }, [userId])

  const account = loaded?.userId === userId ? loaded.account : null

  useEffect(() => {
    if (account === null) return

    const timer = setInterval(() => {
      setNow(Date.now())
    }, TICK_MS)

    return () => {
      clearInterval(timer)
    }
  }, [account])

  if (account === null) return null

  const left = remainingOf(account.expiresAt, now)

  return (
    <div
      className={`border-warning bg-warning-surface text-fg flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-sm ${SHAPE[variant]}`}
      role="status"
    >
      <span className="font-medium">{messages.bannerLabel}</span>
      <span>{sentenceFor(left, messages)}</span>
    </div>
  )
}

function sentenceFor(left: ReturnType<typeof remainingOf>, messages: DemoMessages): string {
  if (left.expired) return messages.expired

  // Two sentences rather than one with a zero in it: "0시간 12분 남음" reads as
  // a bug, and the copy is where word order belongs.
  return left.hours > 0
    ? fill(messages.remaining, { hours: left.hours, minutes: left.minutes })
    : fill(messages.remainingMinutes, { minutes: left.minutes })
}
