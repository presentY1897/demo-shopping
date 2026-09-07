import Link from 'next/link'

import { RequireSignIn } from '@/components/auth/require-sign-in'
import { AccountSummary } from '@/components/mypage/account-summary'
import { PlaceholderScreen } from '@/components/placeholder-screen'
import { messagesFor } from '@/messages'

/**
 * The account menu's destination.
 *
 * Still a placeholder as a **dashboard** — 주문 요약은 M09 의 화면이 소유한다 — 이지만
 * 더 이상 링크 목록만은 아니다. TASK-0077 이 여기에 **적립금 잔액과 쿠폰 수**를 얹었고
 * (`docs/design/pages.md` 가 이 라우트에 적어 둔 셋 중 둘), 그 둘을 요약이 말하는 이유는
 * 「있다」를 알아야 사람이 그 화면으로 가기 때문이다. 나머지 화면들의 링크는 TASK-0112 ·
 * TASK-0058 이 살려 둔 것 그대로이고, 가드는 TASK-0023 의 것이며 그대로 남는다.
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
        {/*
          요약이 링크 목록보다 **위**다. 그것이 이 화면에 오는 사람이 찾는 답이고,
          내비게이션은 그 답을 확인한 뒤에 가는 곳이다.
        */}
        <AccountSummary messages={messages.mypage.summary} />

        <nav aria-label={nav.label}>
          <ul className="flex flex-wrap gap-4">
            <li>
              <Link className="text-primary text-sm font-medium underline" href="/mypage/orders">
                {nav.orders}
              </Link>
            </li>
            <li>
              <Link className="text-primary text-sm font-medium underline" href="/mypage/coupons">
                {nav.coupons}
              </Link>
            </li>
            <li>
              <Link className="text-primary text-sm font-medium underline" href="/mypage/points">
                {nav.points}
              </Link>
            </li>
            <li>
              <Link className="text-primary text-sm font-medium underline" href="/mypage/reviews">
                {nav.reviews}
              </Link>
            </li>
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
