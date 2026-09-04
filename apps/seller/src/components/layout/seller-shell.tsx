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

import { ConsoleShell } from '@shopping/ui/console'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import type { ConsoleLayoutMessages } from '@/messages'

import { AccountIcon, BellIcon } from './console-icons'
import { ConsoleSlot } from './console-slots'

export function SellerShell({
  messages,
  children,
}: {
  readonly messages: ConsoleLayoutMessages
  readonly children: ReactNode
}) {
  return (
    <ConsoleShell
      brand={messages.brand}
      currentPath={usePathname()}
      labels={messages.shell}
      // `next/link` satisfies the shell's link contract as it stands — every
      // prop the shell passes is a plain anchor prop.
      linkComponent={Link}
      menu={messages.menu}
      notifications={
        <ConsoleSlot messages={messages.notifications}>
          <BellIcon className="size-5" />
        </ConsoleSlot>
      }
      userMenu={
        <ConsoleSlot messages={messages.account}>
          <AccountIcon className="size-5" />
        </ConsoleSlot>
      }
    >
      {children}
    </ConsoleShell>
  )
}
