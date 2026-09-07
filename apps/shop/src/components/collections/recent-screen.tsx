'use client'

import { Button, EmptyState, Tag } from '@shopping/ui/components'
import { formatMoney } from '@shopping/ui/format'
import Link from 'next/link'
import { useState } from 'react'

import {
  AccountLoadFailure,
  AccountLoading,
  AccountNotice,
} from '@/components/mypage/account-notices'
import { useRecentlyViewed } from '@/lib/collections/use-recently-viewed'
import type { MyPageMessages } from '@/messages'

/** DECISIONS 1장: 한국어·KRW 우선. */
const CURRENCY = 'KRW'

/**
 * `/mypage/recent` — 최근 본 상품 (TASK-0087 F7).
 *
 * ## 로그인하지 않아도 열린다
 *
 * `/mypage` 아래에 있지만 `RequireSignIn` 으로 감싸지 않는다 — 비로그인 이력이
 * 브라우저에 있고(F6), 그 사람이 자기 이력을 지울 자리가 여기 말고 없다. 대신 그
 * 이력이 이 브라우저에만 있다는 사실을 문장으로 말한다.
 *
 * ## 지우기는 되돌리지 않는다
 *
 * 실패하면 줄이 돌아오는 것이 아니라 「지우지 못했다」가 나오고 목록을 다시 읽는다.
 * 지우기는 되돌릴 일이 아니라 **다시 누를** 일이기 때문이다.
 *
 * 전체 삭제에 확인 다이얼로그를 두지 않는다. 잃는 것이 열람 이력이고, 되찾는 방법이
 * 상품을 다시 보는 것뿐이라 가볍다 — 배송지 삭제가 확인을 거치는 것과 무게가 다르다.
 */
export function RecentScreen({ messages }: { readonly messages: MyPageMessages }) {
  const copy = messages.recent
  const recent = useRecentlyViewed()
  const [cleared, setCleared] = useState(false)

  if (recent.state.status === 'loading') return <AccountLoading label={copy.loadingLabel} />

  if (recent.state.status === 'error') {
    return (
      <AccountLoadFailure
        failure={recent.state.failure}
        messages={messages}
        onRetry={recent.reload}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {recent.local ? <p className="text-fg-subtle text-sm">{copy.localNotice}</p> : null}
      {cleared ? <AccountNotice>{copy.clearedNotice}</AccountNotice> : null}
      {recent.failed ? (
        <p className="text-danger text-sm" role="status">
          {copy.failedNotice}
        </p>
      ) : null}

      {recent.items.length === 0 ? (
        <EmptyState description={copy.emptyBody} title={copy.emptyTitle} />
      ) : (
        <>
          <div>
            <Button
              onClick={() => {
                setCleared(true)
                recent.clear()
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              {copy.clearLabel}
            </Button>
          </div>

          <ul
            aria-label={copy.listLabel}
            className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4"
          >
            {recent.items.map((item) => (
              <li
                className="border-border flex flex-col gap-2 rounded-md border p-3"
                key={item.productId}
              >
                <Link className="flex flex-col gap-1" href={`/products/${item.productId}`}>
                  <div className="bg-surface-muted border-border aspect-square w-full overflow-hidden rounded-md border">
                    {item.thumbnailUrl === null ? null : (
                      // eslint-disable-next-line @next/next/no-img-element -- 주소의 호스트가 배포마다 다르다.
                      <img
                        alt=""
                        className="h-full w-full object-cover"
                        decoding="async"
                        loading="lazy"
                        src={item.thumbnailUrl}
                      />
                    )}
                  </div>
                  <span className="text-fg-subtle text-xs">{item.brandName}</span>
                  <span className="text-fg line-clamp-2 text-sm font-medium">
                    {item.productName}
                  </span>
                </Link>

                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-fg text-base font-bold">
                    {item.price === null
                      ? copy.noPrice
                      : formatMoney({ amount: item.price, currency: CURRENCY })}
                  </span>
                  {item.price === null ? <Tag>{copy.soldOut}</Tag> : null}
                </div>

                <div>
                  <Button
                    onClick={() => {
                      recent.remove(item.productId)
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {copy.removeLabel.replace('{name}', item.productName)}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
