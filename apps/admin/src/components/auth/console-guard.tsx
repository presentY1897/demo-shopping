'use client'

import { Skeleton } from '@shopping/ui/components'
import { PageContainer } from '@shopping/ui/layout'
import { usePathname, useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useEffect } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import {
  isOpenRoute,
  isSignedInOnlyRoute,
  LOGIN_ROUTE,
  mayEnterConsole,
  NO_PERMISSION_ROUTE,
} from '@/lib/auth/console-access'
import { signInHref } from '@/lib/auth/next-path'
import type { ConsoleGuardMessages } from '@/messages'

/**
 * Everything between "the app booted" and "the console is on screen"
 * (TASK-0023 4장).
 *
 * **This is not a Next middleware, and it cannot be one.** The refresh cookie is
 * set by the *API* origin with no `Domain` and `Path=/api/v1/auth`, so it is
 * never attached to a request for one of this app's own routes — there is
 * nothing for `request.cookies` to read. What replaces it is the renewal
 * `AuthProvider` makes on boot, which is strictly more informative: it tells a
 * live session from a dead cookie, and it brings the roles back with it.
 *
 * **The redirect lives in an effect, and the render does not wait for it.**
 * `router.replace` is asynchronous, so between the decision and the navigation
 * there is at least one frame; returning the console in that frame would flash
 * the sidebar and the operator's data at somebody who is not allowed to see it.
 */
export function ConsoleGuard({
  messages,
  children,
}: {
  readonly messages: ConsoleGuardMessages
  readonly children: ReactNode
}) {
  const { state } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  const open = isOpenRoute(pathname)
  const roleNeeded = !isSignedInOnlyRoute(pathname)
  const allowed = state.status === 'signedIn' && (!roleNeeded || mayEnterConsole(state.user.roles))

  useEffect(() => {
    if (open || state.status === 'checking' || allowed) return

    if (state.status === 'anonymous') {
      // The path travels as `next` so that a bookmark deep in the console comes
      // back to itself rather than to the dashboard.
      router.replace(signInHref(LOGIN_ROUTE, pathname))
      return
    }

    router.replace(NO_PERMISSION_ROUTE)
  }, [open, allowed, state.status, pathname, router])

  if (open || allowed) return <>{children}</>

  return (
    <PageContainer className="py-8">
      <div aria-busy="true" aria-label={messages.checkingLabel} role="status">
        <Skeleton className="h-40 w-full" />
      </div>
    </PageContainer>
  )
}
