'use client'

/**
 * A navigation link that says when it has been pressed.
 *
 * `app/loading.tsx` covers the destination — a skeleton appears where the new
 * screen will be — but it says nothing at the place the visitor is actually
 * looking, which is the link under their finger. On a cold Render instance the
 * gap between the tap and the new screen is long enough to be tapped twice.
 *
 * `useLinkStatus()` (Next 16) reports the pending state of the `<Link>` it is
 * rendered inside, so the indicator lives in the link itself and no router
 * subscription, pathname comparison or global progress bar is involved.
 */

import Link, { useLinkStatus } from 'next/link'
import type { ReactNode } from 'react'

interface NavLinkProps {
  readonly href: string
  readonly children: ReactNode
  readonly className?: string
  /** Announced while the destination is loading — "이동 중". */
  readonly pendingLabel: string
  readonly onNavigate?: () => void
}

export function NavLink({ href, children, className, pendingLabel, onNavigate }: NavLinkProps) {
  return (
    <Link
      className={className}
      href={href}
      onClick={() => {
        onNavigate?.()
      }}
    >
      {children}
      <LinkPending label={pendingLabel} />
    </Link>
  )
}

/**
 * Renders nothing until the navigation it belongs to is in flight.
 *
 * `role="status"` rather than a bare span: the spinner is the only signal a
 * sighted visitor gets, and a screen reader user needs the same information
 * announced once, politely.
 */
function LinkPending({ label }: { readonly label: string }) {
  const { pending } = useLinkStatus()

  if (!pending) return null

  return (
    <span
      aria-label={label}
      className="border-current border-t-transparent ml-2 inline-block size-3 shrink-0 animate-spin rounded-full border-2 align-middle"
      role="status"
    />
  )
}
