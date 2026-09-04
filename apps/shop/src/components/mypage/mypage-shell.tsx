import { PageContainer } from '@shopping/ui/layout'
import Link from 'next/link'
import type { ReactNode } from 'react'

import type { MyPageNavMessages } from '@/messages'

/**
 * The frame both account screens sit in (TASK-0112 4장).
 *
 * A server component: it renders a heading, two links and whatever the screen
 * passes, none of which needs the browser. The screens themselves are client
 * components because they hold a session and a form, and keeping the frame out
 * of that boundary means the markup around the skeleton is server-rendered
 * while the API may still be waking up.
 *
 * **The nav is two plain links, not a tab set.** These are two routes, not two
 * panels of one screen: a `Tabs` would say the content swaps in place, would
 * take the browser's back button out of the story, and would need JavaScript to
 * do what an anchor already does.
 *
 * Spacing is entirely in density-scaled tokens (`gap-*`, `py-*` resolve through
 * `--space-unit`), so all three steps lay out from one set of classes — which is
 * what P6 asks and what makes six render combinations a test rather than six
 * designs.
 */
export function MyPageShell({
  title,
  description,
  nav,
  current,
  children,
}: {
  readonly title: string
  readonly description: string
  readonly nav: MyPageNavMessages
  /** Which of the two routes is being shown, so it is not a link to itself. */
  readonly current: 'settings' | 'addresses'
  readonly children: ReactNode
}) {
  return (
    <PageContainer className="flex flex-col gap-6 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-fg-muted text-sm">{description}</p>
      </header>

      <nav aria-label={nav.label}>
        <ul className="flex flex-wrap gap-4">
          <MyPageNavItem
            current={current === 'settings'}
            href="/mypage/settings"
            label={nav.settings}
          />
          <MyPageNavItem
            current={current === 'addresses'}
            href="/mypage/addresses"
            label={nav.addresses}
          />
        </ul>
      </nav>

      {children}
    </PageContainer>
  )
}

/**
 * `aria-current="page"` rather than a removed link.
 *
 * Dropping the link for the current route would move the other one sideways
 * between the two screens, and hiding a landmark's own entry is how a person
 * loses track of where they are. The attribute is what a screen reader reads
 * out, and the underline is the same fact for everybody else.
 */
function MyPageNavItem({
  href,
  label,
  current,
}: {
  readonly href: string
  readonly label: string
  readonly current: boolean
}) {
  return (
    <li>
      <Link
        aria-current={current ? 'page' : undefined}
        className={
          current
            ? 'text-fg text-sm font-semibold underline'
            : 'text-fg-muted hover:text-fg text-sm'
        }
        href={href}
      >
        {label}
      </Link>
    </li>
  )
}
