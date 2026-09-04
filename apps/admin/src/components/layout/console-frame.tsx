'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { ConsoleGuard } from '@/components/auth/console-guard'
import { DemoBanner } from '@/components/demo/demo-banner'
import { isOpenRoute } from '@/lib/auth/console-access'
import { messagesFor } from '@/messages'

import { AdminShell } from './admin-shell'

/**
 * What the root layout wraps every route in (TASK-0023).
 *
 * Two jobs, both about *which* frame a route gets rather than about what is in
 * it.
 *
 * **The sign-in and the refusal screens are drawn bare.** A sidebar of thirteen
 * links above a page whose whole content is "you cannot use this console" is not
 * a navigation aid, it is thirteen links back to the same refusal.
 * `docs/design/pages.md` already keeps these two out of the menu; this is what
 * makes it true of the shell as well.
 *
 * **Everything else goes through the guard.** The branch is here rather than
 * inside the shell so the shell stays what it was — a menu, a top bar and a
 * content area — and its spec keeps testing that rather than a session.
 *
 * A client component, and it has to be: the decision is the current path, and
 * the shell below it is a client component too.
 */
export function ConsoleFrame({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname()
  const messages = messagesFor()

  // The demo banner is drawn on both sides of the branch and **inside** the
  // shell on the guarded one. Above the shell it is covered: the sidebar is
  // `fixed` from the top of the viewport, so a banner in normal flow above it
  // pushes the content down and slides underneath the navigation (TASK-0024 9장).
  if (isOpenRoute(pathname)) {
    return (
      <>
        <DemoBanner messages={messages.demo} />
        {children}
      </>
    )
  }

  return (
    <AdminShell messages={messages.layout}>
      <DemoBanner messages={messages.demo} variant="card" />
      <ConsoleGuard messages={messages.auth.guard}>{children}</ConsoleGuard>
    </AdminShell>
  )
}
