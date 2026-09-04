'use client'

import type { Role } from '@shopping/shared'
import { Button, GuardedButton, IconButton, Popover } from '@shopping/ui/components'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import { LOGIN_ROUTE } from '@/lib/auth/console-access'
import type { UserMenuMessages } from '@/messages'

/**
 * The top bar's account slot, filled (TASK-0023).
 *
 * Replaces the `ConsoleSlot` popover TASK-0019 left here, which said "로그인과
 * 계정 메뉴는 M04 에서 이 자리에 들어옵니다". Same shape, same size, same place —
 * a control that changed size when the session resolved would move the
 * notification bell sideways on every load.
 *
 * **It is a working control in all three states**, including "we do not know
 * yet": a disabled slot is a dead tab stop, which is the thing TASK-0018 4.5
 * decided against when the slot was first drawn.
 *
 * One of the two identical console copies; `apps/shop` has a third that adds a
 * link to `/mypage`. See `lib/auth/session-client.ts` for why they are copies.
 */
export function ConsoleUserMenu({
  messages,
  icon,
}: {
  readonly messages: UserMenuMessages
  readonly icon: ReactNode
}) {
  const { state, signOut } = useAuth()
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

          <Link className="text-primary text-sm font-medium underline" href={LOGIN_ROUTE}>
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
