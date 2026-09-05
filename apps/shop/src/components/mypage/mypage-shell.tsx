import { PageContainer } from '@shopping/ui/layout'
import Link from 'next/link'
import type { ReactNode } from 'react'

import type { MyPageNavMessages } from '@/messages'

/**
 * The frame the account screens sit in (TASK-0112 4장, TASK-0058 이 셋째를 더한다).
 *
 * A server component: it renders a heading, two links and whatever the screen
 * passes, none of which needs the browser. The screens themselves are client
 * components because they hold a session and a form, and keeping the frame out
 * of that boundary means the markup around the skeleton is server-rendered
 * while the API may still be waking up.
 *
 * **The nav is plain links, not a tab set.** These are separate routes, not
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
  /** Which of the four routes is being shown, so it is not a link to itself. */
  readonly current: 'orders' | 'settings' | 'addresses' | 'cards'
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
          {/*
            주문 내역 (TASK-0063). 계정 화면 넷 중 사람이 가장 자주 찾는 것이라 맨
            앞이다 — 마이페이지에 오는 이유의 대부분이 「내 주문 어디까지 왔나」다.
          */}
          <MyPageNavItem current={current === 'orders'} href="/mypage/orders" label={nav.orders} />
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
          {/*
            가상 카드 (TASK-0058). 결제 화면의 「카드가 없어요」가 갈 곳이기도 하다 —
            그 안내가 `/mypage` 를 가리키고 있었던 것은 이 화면이 없었기 때문이다.
          */}
          <MyPageNavItem current={current === 'cards'} href="/mypage/cards" label={nav.cards} />
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
