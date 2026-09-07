'use client'

import type { RecentlyViewedItem } from '@shopping/shared'
import { formatMoney } from '@shopping/ui/format'
import Link from 'next/link'
import { useId } from 'react'

import { useRecentlyViewed } from '@/lib/collections/use-recently-viewed'
import type { RecentlyViewedMessages } from '@/messages'

/** DECISIONS 1장: 한국어·KRW 우선. */
const CURRENCY = 'KRW'

/** 스트립에 들어가는 최대 개수. 가로로 훑는 줄이라 끝이 있어야 한다. */
const STRIP_MAX = 10

/**
 * 홈과 상품 상세 아래의 「최근 본 상품」 (TASK-0087).
 *
 * ## 비어 있으면 **아무것도 그리지 않는다**
 *
 * 「최근 본 상품이 없습니다」를 홈에 그리면 처음 온 사람의 첫 화면에 빈 상자가 하나
 * 늘어난다 — 그것은 안내가 아니라 아직 아무것도 하지 않았다는 지적이다. 전체 목록을
 * 찾아온 사람에게는 그 문장이 필요하고, 그 자리가 `/mypage/recent` 다.
 *
 * ## 지금 보고 있는 상품은 빼고 그린다
 *
 * 상품 상세에 붙을 때, 자기 자신이 스트립의 맨 앞에 오면 「최근 본 상품」이 지금 보는
 * 상품을 가리키게 된다. 로그인한 사람에게는 서버가 방금 기록해 두었기 때문에, 로그인
 * 안 한 사람에게는 브라우저가 방금 적었기 때문에 — 양쪽 다 일어난다.
 *
 * ## 밀도를 읽지 않는다
 *
 * 가로로 스크롤하는 줄 하나이고, 그 줄의 칸 수는 밀도가 아니라 **화면 폭**이 정한다.
 * 밀도가 정하는 간격은 토큰(`gap-*`)이 이미 나르고 있다.
 */
export function RecentlyViewedStrip({
  copy,
  exclude = null,
}: {
  readonly copy: RecentlyViewedMessages
  /** 지금 보고 있는 상품. 홈에서는 없다. */
  readonly exclude?: string | null
}) {
  const recent = useRecentlyViewed()
  const headingId = useId()

  const items = recent.items.filter((item) => item.productId !== exclude).slice(0, STRIP_MAX)

  if (items.length === 0) return null

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-fg text-lg font-semibold" id={headingId}>
          {copy.title}
        </h2>
        <Link
          className="text-fg-muted text-sm underline-offset-2 hover:underline"
          href="/mypage/recent"
        >
          {copy.moreLabel}
        </Link>
      </div>

      {/*
        브라우저에만 남는 기록이라는 사실을 말한다. 말하지 않으면 다른 기기에서
        로그인한 사람이 「이력이 사라졌다」고 읽는다 (F6).
      */}
      {recent.local ? <p className="text-fg-subtle text-xs">{copy.localNotice}</p> : null}

      <ul aria-label={copy.listLabel} className="flex gap-3 overflow-x-auto pb-1">
        {items.map((item) => (
          <li className="w-32 shrink-0" key={item.productId}>
            <RecentTile copy={copy} item={item} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * 한 칸 — 그림, 이름, 가격.
 *
 * 링크의 이름을 `aria-label` 로 주는 이유는 그 안에 이름과 가격과 「품절」이 함께
 * 들어 있기 때문이다. 셋을 그대로 읽어 주면 목록을 훑는 사람에게 한 칸이 세 덩어리로
 * 들린다 — 상품 카드가 같은 이유로 같은 모양이다 (`packages/ui` 의 `ProductCard`).
 */
function RecentTile({
  copy,
  item,
}: {
  readonly copy: RecentlyViewedMessages
  readonly item: RecentlyViewedItem
}) {
  return (
    <Link
      aria-label={copy.openLabel.replace('{name}', item.productName)}
      className="flex flex-col gap-1"
      href={`/products/${item.productId}`}
    >
      <div className="bg-surface-muted border-border aspect-square w-full overflow-hidden rounded-md border">
        {item.thumbnailUrl === null ? null : (
          // eslint-disable-next-line @next/next/no-img-element -- 주소의 호스트가 배포마다 다르다 (`review-card.tsx` 의 같은 이유).
          <img
            alt=""
            className="h-full w-full object-cover"
            decoding="async"
            loading="lazy"
            src={item.thumbnailUrl}
          />
        )}
      </div>
      <span aria-hidden="true" className="text-fg-subtle text-xs">
        {item.brandName}
      </span>
      <span aria-hidden="true" className="text-fg line-clamp-2 text-xs font-medium">
        {item.productName}
      </span>
      <span aria-hidden="true" className="text-fg text-xs font-bold">
        {item.price === null
          ? copy.soldOut
          : formatMoney({ amount: item.price, currency: CURRENCY })}
      </span>
    </Link>
  )
}
