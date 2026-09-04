'use client'

/**
 * `seller`'s half of the console shell: the menu, the router, and the two slots.
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
import { useAuth } from '@/lib/auth/auth-context'
import { mayEnterConsole } from '@/lib/auth/console-access'
import type { ConsoleLayoutMessages } from '@/messages'
import { messagesFor } from '@/messages'

import { AccountIcon, BellIcon } from './console-icons'
import { ConsoleSlot } from './console-slots'

export function SellerShell({
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
  const { state } = useAuth()

  /**
   * Whether this account may be in the console at all.
   *
   * `true` while the session is still unknown, for the same reason the filter
   * below is skipped then: a sidebar that collapses to one entry and expands a
   * frame later is a layout that jumps on every load.
   */
  const entering = state.status === 'signedIn' ? mayEnterConsole(state.user.roles) : true

  /**
   * The sidebar, minus what this account may not reach (TASK-0023 F8).
   *
   * **Two filters, and they answer different questions.** `mayEnterConsole` asks
   * whether the account belongs in this console — the same question
   * `ConsoleGuard` asks — and a `BUYER` who has applied does not, so their
   * sidebar is the one screen they can use (TASK-0109 4장). Permissions then
   * narrow what is left.
   *
   * The role check has to come first because the permission filter cannot do it:
   * `BUYER_GRANTS` holds `product.read`, `order.read`, `claim.read`,
   * `coupon.read` and `seller.read` — the catalogue is public and their own
   * orders are their own — so filtering an applicant's menu by permission
   * removes exactly one entry and leaves eight links that bounce off the guard.
   *
   * **Unfiltered while the session is still unknown.** Every permission answers
   * `false` in that frame. The menu is a navigation aid; what actually keeps
   * somebody out is `ConsoleGuard` and the API's own guard.
   *
   * `isPermission` rather than a cast: the menu's `permission` is a plain string
   * because `packages/ui` knows no contracts, and a typo there must not quietly
   * grant an entry by failing every lookup the same way.
   */
  const menu = useMemo(() => {
    if (!entering) return messages.onboardingMenu

    return ready
      ? filterConsoleMenu(messages.menu, (name) => isPermission(name) && can(name))
      : messages.menu
  }, [messages.menu, messages.onboardingMenu, can, entering, ready])

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
