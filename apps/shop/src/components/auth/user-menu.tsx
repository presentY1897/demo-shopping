'use client'

import type { Role } from '@shopping/shared'
import { Button, GuardedButton, IconButton, Popover } from '@shopping/ui/components'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import { signInHref } from '@/lib/auth/next-path'
import type { UserMenuMessages } from '@/messages'

/**
 * The account control in the header (TASK-0023).
 *
 * Replaces the placeholder popover the shell has carried since TASK-0018, which
 * said "로그인과 계정 메뉴는 M04 에서 이 자리에 들어옵니다" — this is M04.
 *
 * **It is a working control in all three states**, including "we do not know
 * yet". A control that disappeared while the session was being checked would
 * move the header's other buttons sideways on every load; one that was disabled
 * would be a dead tab stop (TASK-0018 4.5). So the trigger is always the same
 * button and only the panel's contents change.
 *
 * **Signing out is a request, not a local forget.** The refresh token has a row
 * in the database and a cookie in the browser, and dropping the access token
 * alone would leave a session that any reload resurrects.
 */
export function UserMenu({
  messages,
  myPageLabel,
  icon,
}: {
  readonly messages: UserMenuMessages
  /**
   * From `layout.account.mypage`, not from this slice.
   *
   * The header already owns that string for the destination it used to link to
   * directly, and a second copy here would be two names for one screen — the
   * kind that drift the first time somebody renames one of them.
   */
  readonly myPageLabel: string
  readonly icon: ReactNode
}) {
  const { state, signOut } = useAuth()
  const pathname = usePathname()
  const [busy, setBusy] = useState(false)

  return (
    <Popover
      align="end"
      closeLabel={messages.closeLabel}
      title={messages.title}
      trigger={
        <IconButton label={messages.label} size="sm" variant="ghost">
          {icon}
        </IconButton>
      }
    >
      {state.status === 'signedIn' ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-fg-muted text-sm">
            {messages.rolesLabel}:{' '}
            {state.user.roles.map((role) => roleName(messages, role)).join(', ')}
          </p>

          <Link className="text-primary text-sm font-medium underline" href="/mypage">
            {myPageLabel}
          </Link>

          {/*
            Profile editing is TASK-0112. Shown blocked with the reason rather
            than hidden, for the same reason every other unavailable action is.
          */}
          <GuardedButton blocked reason={messages.profileReason} size="sm" variant="ghost">
            {messages.profileLabel}
          </GuardedButton>

          <Button
            loading={busy}
            onClick={() => {
              setBusy(true)
              void signOut().finally(() => {
                setBusy(false)
              })
            }}
            size="sm"
            variant="outline"
          >
            {messages.signOutLabel}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-fg-muted text-sm">{messages.signedOutBody}</p>

          {/*
            The current path travels as `next`, so signing in comes back to the
            screen the visitor was reading rather than to the home page.
          */}
          <Link
            className="text-primary text-sm font-medium underline"
            href={signInHref('/login', pathname)}
          >
            {messages.signInLabel}
          </Link>
        </div>
      )}
    </Popover>
  )
}

/**
 * The Korean name for a role, falling back to the enum value.
 *
 * The fallback is not laziness: `roles` comes from the API, and a role added
 * there before this catalog knows about it must still render *something* rather
 * than an empty line in a list of what the account can do.
 */
function roleName(messages: UserMenuMessages, role: Role): string {
  return messages.roleNames[role] ?? role
}
