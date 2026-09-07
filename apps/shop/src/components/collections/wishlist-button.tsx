'use client'

import { Button } from '@shopping/ui/components'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useAuth } from '@/lib/auth/auth-context'
import { signInHref } from '@/lib/auth/next-path'
import { useWishlistToggle } from '@/lib/collections/use-wishlist-toggle'
import type { WishlistButtonMessages } from '@/messages'

/**
 * 상품 하나의 찜 버튼 (TASK-0086 F1 · F2 · F6).
 *
 * ## 로그인하지 않은 사람에게는 버튼이 아니다
 *
 * 누르는 순간 401 이 돌아오고, 그것은 사람이 고칠 수 없는 실패다. 그래서 그 자리에는
 * **로그인으로 가는 링크**가 놓이고 지금 보던 주소가 `next` 로 따라간다 (F6). 리뷰의
 * 「도움돼요」가 같은 판단을 같은 이유로 한다 (`review-card.tsx`).
 *
 * 비로그인 찜을 브라우저에 담아 두지 않는 것은 R1 의 판단이다 — 장바구니와 달리
 * 구매 흐름을 막지 않으므로, 담아 두었다가 로그인 때 합치는 장치를 만들 값이 없다.
 *
 * ## 모를 때는 눌린 척하지 않는다
 *
 * 계약에 「이 상품을 찜했나」를 묻는 문이 없다(`wishlist-state.ts`). 목록을 한 번
 * 읽어 답을 채우지만 그 답이 오기 전에도 버튼은 눌려야 하고, 그때 `aria-pressed`
 * 를 `false` 로 적으면 **담아 둔 상품 위에서 「누르지 않음」이라고 말하는** 셈이 된다.
 * 그래서 모르는 동안에는 그 속성을 아예 두지 않는다 — 토글이 아니라 「찜하기」라는
 * 행동 버튼이고, 한 번 누르면 그때부터 답을 안다.
 */
export function WishlistButton({
  copy,
  productId,
  className,
}: {
  readonly copy: WishlistButtonMessages
  readonly productId: string
  readonly className?: string
}) {
  const { state } = useAuth()
  const pathname = usePathname()
  const wishlist = useWishlistToggle(productId)

  if (state.status !== 'signedIn') {
    return (
      <Link
        className="text-primary min-h-touch inline-flex items-center text-sm underline"
        href={signInHref('/login', pathname)}
      >
        {copy.signIn}
      </Link>
    )
  }

  return (
    <div className={className}>
      <Button
        aria-pressed={wishlist.active ?? undefined}
        loading={wishlist.pending}
        onClick={wishlist.toggle}
        size="sm"
        type="button"
        variant={wishlist.active === true ? 'secondary' : 'outline'}
      >
        {wishlist.active === true ? copy.added : copy.add}
      </Button>

      {/*
        되돌린 뒤에 붙는 줄 (F2). 낙관적으로 바꾼 것을 되돌리는 것만으로는 아무
        일도 일어나지 않은 것처럼 보이고, 사람은 자기가 잘못 눌렀다고 읽는다.
      */}
      {wishlist.failed ? (
        <p className="text-danger text-xs" role="status">
          {copy.failedNotice}
        </p>
      ) : null}
    </div>
  )
}
