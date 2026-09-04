'use client'

/**
 * `admin`'s half of the console shell: the menu, the router, and the two slots.
 *
 * The shared `ConsoleShell` renders; this file supplies what only the app can
 * know — its own route table, its own copy, its own `next/link`. `packages/ui`
 * has no Korean in it and no dependency on Next, and this is where both facts
 * are paid for.
 *
 * A client component because the shell is one: it reads the current path
 * (`usePathname`) to light the right entry, holds the collapsed state across
 * navigations, and asks the window how wide it is. Only the shell is on the
 * client — the screens inside it are the pages Next renders, and
 * {@link PageHeader} stays server-renderable so the heading is in the first
 * paint.
 */

import { isPermission } from '@shopping/shared'
import { ConsoleShell, filterConsoleMenu } from '@shopping/ui/console'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { useMemo } from 'react'

import { ConsoleUserMenu } from '@/components/auth/console-user-menu'
import { useAuthorization } from '@/lib/auth/authorization'
import type { ConsoleLayoutMessages } from '@/messages'
import { messagesFor } from '@/messages'

import { AccountIcon, BellIcon } from './console-icons'
import { ConsoleSlot } from './console-slots'

export function AdminShell({
  messages,
  children,
}: {
  readonly messages: ConsoleLayoutMessages
  readonly children: ReactNode
}) {
  // The account slot's copy is the `auth` slice's, not the layout's: it belongs
  // to signing in rather than to the shell, and the shell is handed the rest of
  // its strings by the caller (TASK-0019 4.9).
  const account = messagesFor().auth.menu
  const { can, ready } = useAuthorization()

  /**
   * The sidebar, minus what this account may not reach (TASK-0023 F8).
   *
   * **Unfiltered while the session is still unknown.** Every permission answers
   * `false` in that frame, and an empty sidebar that fills in a moment later is
   * a layout that jumps on every load. The menu is a navigation aid; what
   * actually keeps somebody out is `ConsoleGuard` and the API's own guard.
   *
   * `isPermission` rather than a cast: the menu's `permission` is a plain string
   * because `packages/ui` knows no contracts, and a typo there must not quietly
   * grant an entry by failing every lookup the same way.
   */
  const menu = useMemo(
    () =>
      ready
        ? filterConsoleMenu(messages.menu, (name) => isPermission(name) && can(name))
        : messages.menu,
    [messages.menu, can, ready],
  )

  return (
    <ConsoleShell
      brand={messages.brand}
      currentPath={usePathname()}
      labels={messages.shell}
      // `next/link` satisfies the shell's link contract as it stands — every
      // prop the shell passes is a plain anchor prop.
      linkComponent={Link}
      menu={menu}
      notifications={
        <ConsoleSlot messages={messages.notifications}>
          <BellIcon className="size-5" />
        </ConsoleSlot>
      }
      userMenu={<ConsoleUserMenu icon={<AccountIcon className="size-5" />} messages={account} />}
    >
      {children}
    </ConsoleShell>
  )
}
