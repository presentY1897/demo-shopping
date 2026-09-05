import Link from 'next/link'

import { RequireSignIn } from '@/components/auth/require-sign-in'
import { PlaceholderScreen } from '@/components/placeholder-screen'
import { messagesFor } from '@/messages'

/**
 * The account menu's destination.
 *
 * Still a placeholder — the dashboard itself (order summary, points, coupons)
 * belongs to later milestones — but no longer a dead end: the screens TASK-0112
 * and TASK-0058 built are real, and a shopper who lands here from the header has
 * to be able to reach them. The guard is TASK-0023's and stays.
 */
export default function MyPage() {
  const messages = messagesFor()
  const nav = messages.mypage.nav

  return (
    <RequireSignIn messages={messages.auth.requireSignIn}>
      <PlaceholderScreen
        body={messages.placeholder.mypage.body}
        title={messages.placeholder.mypage.title}
      >
        <nav aria-label={nav.label}>
          <ul className="flex flex-wrap gap-4">
            <li>
              <Link className="text-primary text-sm font-medium underline" href="/mypage/settings">
                {nav.settings}
              </Link>
            </li>
            <li>
              <Link className="text-primary text-sm font-medium underline" href="/mypage/addresses">
                {nav.addresses}
              </Link>
            </li>
            <li>
              <Link className="text-primary text-sm font-medium underline" href="/mypage/cards">
                {nav.cards}
              </Link>
            </li>
          </ul>
        </nav>
      </PlaceholderScreen>
    </RequireSignIn>
  )
}
