'use client'

import type { ApiFailure } from '@shopping/shared'
import { Button, EmptyState } from '@shopping/ui/components'
import Link from 'next/link'

import {
  AccountLoadFailure,
  AccountLoading,
  AccountWriteFailure,
} from '@/components/mypage/account-notices'
import { useFollowList } from '@/lib/collections/use-follow-list'
import type { MyPageMessages } from '@/messages'

const LOCALE = 'ko-KR'

/**
 * `/mypage/following` — 팔로우한 브랜드 (TASK-0089).
 *
 * **팔로워 수가 줄마다 실려 온다**(`followedSellerSchema`). 브랜드관의 버튼이 그
 * 수를 알 수 있는 것도 이 목록 덕분이고, 그 이유는 `follow-state.ts` 가 적고 있다.
 *
 * 해제는 줄을 지운다. 답이 「아직 팔로우 중」이면 지우지 않는다 — 다른 탭에서 방금
 * 끊은 것을 이 클릭이 다시 이은 경우다.
 */
export function FollowingScreen({ messages }: { readonly messages: MyPageMessages }) {
  const copy = messages.following
  const follows = useFollowList()

  if (follows.state.status === 'loading') return <AccountLoading label={copy.loadingLabel} />

  if (follows.state.status === 'error') {
    return (
      <AccountLoadFailure
        failure={follows.state.failure}
        messages={messages}
        onRetry={follows.reload}
      />
    )
  }

  if (follows.sellers.length === 0) {
    return (
      <EmptyState
        action={
          <Link className="text-primary text-sm font-medium underline" href="/search">
            {copy.emptyAction}
          </Link>
        }
        description={copy.emptyBody}
        title={copy.emptyTitle}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ul aria-label={copy.listLabel} className="flex flex-col gap-3">
        {follows.sellers.map((seller) => (
          <li
            className="border-border flex flex-col gap-2 rounded-md border p-3"
            key={seller.sellerId}
          >
            <div className="flex items-center gap-3">
              {seller.logoUrl === null ? null : (
                // eslint-disable-next-line @next/next/no-img-element -- 스토어 로고의 호스트가 배포마다 다르다.
                <img
                  alt={copy.logoAlt.replace('{brand}', seller.brandName)}
                  className="border-border size-12 shrink-0 rounded-md border object-cover"
                  src={seller.logoUrl}
                />
              )}

              <div className="flex min-w-0 flex-col">
                <Link
                  className="text-fg text-sm font-medium underline-offset-2 hover:underline"
                  href={`/brands/${seller.sellerId}`}
                >
                  {seller.brandName}
                </Link>
                <span className="text-fg-subtle text-xs">
                  {copy.followerCount.replace(
                    '{count}',
                    seller.followerCount.toLocaleString(LOCALE),
                  )}
                </span>
              </div>

              <div className="ml-auto shrink-0">
                <Button
                  loading={follows.pending === seller.sellerId}
                  onClick={() => {
                    follows.unfollow(seller.sellerId)
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {copy.unfollowLabel.replace('{brand}', seller.brandName)}
                </Button>
              </div>
            </div>

            <RowFailure
              failure={follows.failures[seller.sellerId]}
              messages={messages}
              title={copy.writeErrorTitle}
            />
          </li>
        ))}
      </ul>

      {follows.hasMore ? (
        <div>
          <Button
            loading={follows.loadingMore}
            onClick={follows.loadMore}
            size="sm"
            type="button"
            variant="outline"
          >
            {follows.loadingMore ? copy.moreLoading : copy.moreLabel}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** 그 줄에서 방금 실패한 것. 위시리스트가 같은 이유로 같은 모양을 갖는다. */
function RowFailure({
  failure,
  messages,
  title,
}: {
  readonly failure: ApiFailure | undefined
  readonly messages: MyPageMessages
  readonly title: string
}) {
  if (failure === undefined) return null

  return <AccountWriteFailure failure={failure} messages={messages} title={title} />
}
