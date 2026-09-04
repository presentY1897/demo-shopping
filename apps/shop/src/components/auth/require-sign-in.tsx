'use client'

import { EmptyState, Skeleton } from '@shopping/ui/components'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import { signInHref } from '@/lib/auth/next-path'
import type { RequireSignInMessages } from '@/messages'

/**
 * A storefront screen that only means something for a signed-in shopper.
 *
 * **It does not redirect.** `apps/shop` is a public site: bouncing somebody off
 * the page they bookmarked would lose the address, and the account screens are
 * few enough that an invitation reads better than a jump. The consoles are the
 * other way round — there is nothing to show at all without a role, so they
 * redirect (TASK-0023 4장).
 *
 * The three states are the three the session can be in, and the middle one is
 * the reason `AuthState` is not a boolean: a skeleton while the answer is
 * unknown, rather than a sign-in prompt that flashes for every returning
 * shopper.
 */
export function RequireSignIn({
  messages,
  children,
}: {
  readonly messages: RequireSignInMessages
  readonly children: ReactNode
}) {
  const { state } = useAuth()
  const pathname = usePathname()

  if (state.status === 'checking') {
    return (
      <div aria-busy="true" aria-label={messages.checkingLabel} role="status">
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (state.status === 'anonymous') {
    return (
      <EmptyState
        action={
          <Link
            className="text-primary text-sm font-medium underline"
            href={signInHref('/login', pathname)}
          >
            {messages.action}
          </Link>
        }
        description={messages.body}
        title={messages.title}
      />
    )
  }

  return <>{children}</>
}
