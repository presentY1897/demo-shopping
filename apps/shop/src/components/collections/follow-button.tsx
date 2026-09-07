'use client'

import { Button } from '@shopping/ui/components'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useAuth } from '@/lib/auth/auth-context'
import { signInHref } from '@/lib/auth/next-path'
import { useFollow } from '@/lib/collections/use-follow'
import type { FollowButtonMessages } from '@/messages'

const LOCALE = 'ko-KR'

/**
 * 브랜드 하나의 팔로우 버튼 (TASK-0089 F1 · F3).
 *
 * ## 팔로워 수는 **화면이 들고 와서** 넘긴다
 *
 * 공개 응답(`GET /sellers/:id`)이 그 수를 언제나 싣는다(4.3). 그래서 브랜드관은
 * 팔로우하지 않은 사람에게도, 로그인하지 않은 사람에게도 수를 보여 준다 — 그리고
 * 그 사람이 바로 이 수를 근거로 쓰는 사람이다. 「팔로우한 뒤에야 나타나는 수」는
 * F3 을 지킨 것이 아니라 물어볼 수 없게 만든 것이었다.
 *
 * 수를 **모르는 자리도 남아 있다.** 상품 상세의 판매자는 `{ id, brandName }` 뿐이라
 * 그 화면은 수를 넘길 수 없고, 그때는 그리지 않는다 — 0을 그리면 팔로워가 백 명인
 * 브랜드에 대한 거짓말이 된다.
 *
 * ## 누르면 수가 **답이 말한 값으로** 바뀐다
 *
 * 화면이 ±1 을 하지 않는다. 두 탭에서 누른 사람의 화면이 서로 다른 수를 그리고 어느
 * 쪽도 맞지 않는다 (`followResultSchema` 의 머리말). 그래서 답이 오기 전 한순간은
 * 「팔로잉 · 팔로워 128」처럼 보이고, 그것은 틀린 화면이 아니라 **아직 세지 않은
 * 화면**이다.
 *
 * ## 로그인하지 않은 사람에게는 링크다
 *
 * 찜 버튼과 같은 이유다 — 눌러서 401 을 받는 것은 사람이 고칠 수 없는 실패다. 수는
 * 그 옆에 그대로 있다: 팔로우 여부는 로그인해야 알 수 있지만 팔로워 수는 공개다.
 */
export function FollowButton({
  copy,
  sellerId,
  followerCount,
}: {
  readonly copy: FollowButtonMessages
  readonly sellerId: string
  /** 화면이 아는 지금 팔로워 수. 모르는 화면은 넘기지 않는다. */
  readonly followerCount?: number
}) {
  const { state } = useAuth()
  const pathname = usePathname()
  const follow = useFollow(sellerId)

  const active = follow.facts?.active === true
  // 토글의 답이 있으면 그것이 이긴다 — 방금 누른 사람에게 페이지가 서버 렌더 때
  // 들고 온 수는 이미 하나 낡았다.
  const shown = follow.facts?.followerCount ?? followerCount ?? null

  return (
    <div className="flex flex-col items-end gap-1">
      {state.status === 'signedIn' ? (
        <Button
          aria-pressed={follow.facts === null ? undefined : active}
          loading={follow.pending}
          onClick={follow.toggle}
          size="sm"
          type="button"
          variant={active ? 'secondary' : 'outline'}
        >
          {active ? copy.following : copy.follow}
        </Button>
      ) : (
        <Link
          className="text-primary min-h-touch inline-flex items-center text-sm underline"
          href={signInHref('/login', pathname)}
        >
          {copy.signIn}
        </Link>
      )}

      {shown === null ? null : (
        <p className="text-fg-subtle text-xs">
          {copy.followerCount.replace('{count}', shown.toLocaleString(LOCALE))}
        </p>
      )}

      {follow.failed ? (
        <p className="text-danger text-xs" role="status">
          {copy.failedNotice}
        </p>
      ) : null}
    </div>
  )
}
