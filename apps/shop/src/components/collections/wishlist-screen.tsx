'use client'

import { ProductThumbnail } from '@/components/products/product-thumbnail'

import type { ApiFailure, WishlistItem } from '@shopping/shared'
import { Button, EmptyState, Tag } from '@shopping/ui/components'
import { formatMoney } from '@shopping/ui/format'
import Link from 'next/link'

import {
  AccountLoadFailure,
  AccountLoading,
  AccountWriteFailure,
} from '@/components/mypage/account-notices'
import { priceChange } from '@/lib/collections/price-change'
import { useWishlist } from '@/lib/collections/use-wishlist'
import type { MyPageMessages } from '@/messages'

/** DECISIONS 1장: 한국어·KRW 우선. */
const CURRENCY = 'KRW'

/**
 * `/mypage/wishlist` — 담아 둔 것들 (TASK-0086 F3 · F4 · F5).
 *
 * ## 이 화면의 존재 이유는 **그 사이에 무엇이 바뀌었나**다
 *
 * 담아 둔 목록을 다시 보는 사람이 알고 싶은 것은 이름이 아니라 「아직 있나」와
 * 「싸졌나」다. 그래서 계약이 지금 가격과 담을 때 가격을 나란히 싣고
 * (`wishlistItemSchema`), 화면은 그 둘의 차이를 **문장으로** 말한다 — 두 숫자를
 * 나란히 그려 놓고 사람에게 빼기를 시키지 않는다.
 *
 * ## 품절 줄에는 할 일이 하나 더 있다
 *
 * 재입고 알림이다(F4). 품절이라 못 산 상품이 여기 쌓이므로, 이 자리가 그 신청의
 * 가장 자연스러운 진입점이다(4장). 신청은 **찜한 것에만** 걸 수 있고, 이 목록의
 * 줄은 전부 찜한 것이다.
 *
 * ## 장바구니로 바로 담지 않는다
 *
 * 장바구니는 조합을 받는데(`addCartItemRequestSchema` 의 `variantId`) 찜 목록의
 * 줄은 상품이라 조합이 없다. 하나를 골라 담으면 화면이 사람 대신 색과 치수를 고르는
 * 셈이 되므로, 상품 화면으로 보내고 그 이유를 한 줄로 말한다.
 */
export function WishlistScreen({ messages }: { readonly messages: MyPageMessages }) {
  const copy = messages.wishlist
  const wishlist = useWishlist()

  if (wishlist.state.status === 'loading') return <AccountLoading label={copy.loadingLabel} />

  if (wishlist.state.status === 'error') {
    return (
      <AccountLoadFailure
        failure={wishlist.state.failure}
        messages={messages}
        onRetry={wishlist.reload}
      />
    )
  }

  if (wishlist.items.length === 0) {
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
      <ul
        aria-label={copy.listLabel}
        className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4"
      >
        {wishlist.items.map((item) => (
          <li
            className="border-border flex flex-col gap-2 rounded-md border p-3"
            key={item.productId}
          >
            <WishlistRow copy={copy} item={item} wishlist={wishlist} />
            <RowFailure
              failure={wishlist.failures[item.productId]}
              messages={messages}
              title={copy.writeErrorTitle}
            />
          </li>
        ))}
      </ul>

      {wishlist.hasMore ? (
        <div>
          <Button
            loading={wishlist.loadingMore}
            onClick={wishlist.loadMore}
            size="sm"
            type="button"
            variant="outline"
          >
            {wishlist.loadingMore ? copy.moreLoading : copy.moreLabel}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * 그 줄에서 방금 실패한 것.
 *
 * 화면 전체에 한 줄짜리 오류를 붙이면 **어느 줄이 실패했는지**를 말할 수 없다 —
 * 스무 줄 중 하나가 거절당했을 때 사람이 알아야 하는 것이 정확히 그것이다.
 */
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

function WishlistRow({
  copy,
  item,
  wishlist,
}: {
  readonly copy: MyPageMessages['wishlist']
  readonly item: WishlistItem
  readonly wishlist: ReturnType<typeof useWishlist>
}) {
  const change = priceChange(item.addedPrice, item.price)
  const busy = wishlist.pending === item.productId

  return (
    <>
      <Link className="flex flex-col gap-1" href={`/products/${item.productId}`}>
        <div className="bg-surface-muted border-border aspect-square w-full overflow-hidden rounded-md border">
          <ProductThumbnail src={item.thumbnailUrl} className="size-full" />
        </div>
        <span className="text-fg-subtle text-xs">{item.brandName}</span>
        <span className="text-fg line-clamp-2 text-sm font-medium">{item.productName}</span>
      </Link>

      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-fg text-base font-bold">
          {item.price === null
            ? copy.noPrice
            : formatMoney({ amount: item.price, currency: CURRENCY })}
        </span>
        {item.soldOut ? <Tag>{copy.soldOut}</Tag> : null}
      </div>

      {/*
        가격 변동 (F5). 「그대로」와 「모른다」와 「없어졌다」에는 아무 말도 하지
        않는다 — 모든 줄에 「변동 없음」을 적으면 정말 변한 줄이 묻힌다.
      */}
      {change.kind === 'dropped' || change.kind === 'raised' ? (
        <p className={change.kind === 'dropped' ? 'text-danger text-xs' : 'text-fg-muted text-xs'}>
          {(change.kind === 'dropped' ? copy.priceDropped : copy.priceRaised).replace(
            '{amount}',
            formatMoney({ amount: change.amount, currency: CURRENCY }),
          )}
        </p>
      ) : null}

      {item.soldOut ? (
        <div className="flex flex-col gap-1">
          <Button
            aria-pressed={item.notifyRestock}
            loading={busy}
            onClick={() => {
              wishlist.setAlert(item.productId, !item.notifyRestock)
            }}
            size="sm"
            type="button"
            variant={item.notifyRestock ? 'secondary' : 'outline'}
          >
            {item.notifyRestock ? copy.restockOff : copy.restockOn}
          </Button>
          {item.notifyRestock ? (
            <p className="text-fg-subtle text-xs">{copy.restockNotice}</p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <Link
            className="text-primary min-h-touch inline-flex items-center text-sm underline"
            href={`/products/${item.productId}`}
          >
            {copy.openProduct}
          </Link>
          <p className="text-fg-subtle text-xs">{copy.openProductHint}</p>
        </div>
      )}

      <div>
        <Button
          loading={busy}
          onClick={() => {
            wishlist.remove(item.productId)
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          {copy.removeLabel.replace('{name}', item.productName)}
        </Button>
      </div>
    </>
  )
}
