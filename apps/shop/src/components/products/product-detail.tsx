'use client'

/**
 * 상품 상세 (TASK-0043) — 밀도 세 단계가 가장 크게 갈리는 화면.
 *
 * | | 미니멀 | 표준 | 맥시멀 |
 * | --- | --- | --- | --- |
 * | 레이아웃 | 이미지 전면, 긴 스크롤 | 좌 이미지 / 우 정보 | 좌 이미지 / 우 정보 + 사이드 |
 * | 구매 유도 배지 | ✗ | 판매량 | 판매량 · 평점 · 재고 임박 |
 *
 * **세 벌이 아니라 한 벌이다** (R1). 블록은 한 번씩만 쓰여 있고 밀도는 그것들을
 * 어떤 격자에 넣을지와 몇 개를 보일지만 정한다. 완전히 다른 레이아웃 셋은 다음
 * 문구 수정이 들어갈 자리가 셋이라는 뜻이다.
 *
 * **구매 영역은 뷰포트가 정하고, 하나만 마운트된다** (D-055 · F5c). 폰은 하단 고정
 * 바, 데스크톱은 우측 패널이며 둘은 같은 `PurchaseControls` 를 그린다. CSS 로 둘 다
 * 그린 뒤 하나를 숨기면 접근성 트리에 구매 버튼이 두 벌 생긴다.
 */

import type { ProductDetailResponse } from '@shopping/shared'
import { Tag } from '@shopping/ui/components'
import { useDensity } from '@shopping/ui/density'
import { formatMoney } from '@shopping/ui/format'
import { PageContainer, useViewportBand } from '@shopping/ui/layout'
import Link from 'next/link'
import { useState } from 'react'

import type { Selection } from '@/lib/products/variant-selection'
import { useFreshDetail } from '@/lib/products/use-fresh-detail'
import { choose, displayPrice, selectedVariant } from '@/lib/products/variant-selection'
import type { ProductDetailMessages } from '@/messages'

import { OptionPicker } from './option-picker'
import { ProductGallery } from './product-gallery'
import { ProductInfo } from './product-info'
import { PurchaseControls } from './purchase-controls'

/** DECISIONS 1장: 한국어·KRW 우선. */
const CURRENCY = 'KRW'

/** 재고가 이 아래로 내려가면 「N개 남음」을 붙인다. 맥시멀 전용. */
const LOW_STOCK = 10

export function ProductDetail({
  detail: cached,
  messages,
}: {
  readonly detail: ProductDetailResponse
  readonly messages: ProductDetailMessages
}) {
  // The page is served from a cache up to a minute old (TASK-0102 R2). Price and
  // stock are the two things a minute is long enough to be wrong about, and the
  // two a person acts on — so the screen asks again and swaps them in.
  const detail = useFreshDetail(cached)
  const { product, seller, attributes } = detail
  const { density } = useDensity()
  const band = useViewportBand()

  const [selection, setSelection] = useState<Selection>({})
  const [quantity, setQuantity] = useState(1)

  const variant = selectedVariant(product, selection)
  const shown = displayPrice(product, variant)
  const listPrice = shown?.listPrice ?? null
  const discount =
    shown === null || listPrice === null || listPrice <= shown.price
      ? null
      : Math.round(((listPrice - shown.price) / listPrice) * 100)

  const controls = (
    <PurchaseControls
      messages={messages.purchase}
      onQuantityChange={(next) => {
        setQuantity(Math.max(1, next))
      }}
      optionMessages={messages.options}
      product={product}
      quantity={quantity}
      variant={variant}
    />
  )

  const summary = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link
          className="text-fg-muted text-sm underline-offset-2 hover:underline"
          href={`/brands/${seller.id}`}
        >
          {messages.brandLink.replace('{brand}', seller.brandName)}
        </Link>
        <h1 className="text-fg text-xl font-bold">{product.name}</h1>
      </div>

      {density === 1 ? null : (
        <ul className="flex flex-wrap gap-1">
          <li>
            <Tag>
              {messages.info.badges.salesCount.replace(
                '{count}',
                product.salesCount.toLocaleString('ko-KR'),
              )}
            </Tag>
          </li>
          {density === 3 ? (
            <>
              <li>
                <Tag>
                  {messages.info.badges.rating.replace(
                    '{score}',
                    (product.ratingAvg / 100).toFixed(1),
                  )}
                </Tag>
              </li>
              {variant !== null && variant.stock > 0 && variant.stock <= LOW_STOCK ? (
                <li>
                  <Tag variant="primary">
                    {messages.info.badges.lowStock.replace('{count}', String(variant.stock))}
                  </Tag>
                </li>
              ) : null}
            </>
          ) : null}
        </ul>
      )}

      {shown === null ? null : (
        <div className="flex items-baseline gap-2">
          {discount === null ? null : (
            <span className="text-danger text-lg font-bold">{discount}%</span>
          )}
          <span className="text-fg text-2xl font-bold">
            {formatMoney({ amount: shown.price, currency: CURRENCY })}
          </span>
          {listPrice === null || discount === null ? null : (
            <span className="text-fg-subtle text-sm line-through">
              {formatMoney({ amount: listPrice, currency: CURRENCY })}
            </span>
          )}
        </div>
      )}

      <OptionPicker
        messages={messages.options}
        onChoose={(optionId, valueId) => {
          setSelection((held) => choose(held, optionId, valueId))
          setQuantity(1)
        }}
        product={product}
        selection={selection}
      />

      {variant === null ? null : (
        <p className="text-fg-subtle text-xs">
          {messages.options.skuLabel}: {variant.sku}
          {variant.stock > 0
            ? ` · ${messages.options.stockLabel.replace('{count}', String(variant.stock))}`
            : ''}
        </p>
      )}
    </div>
  )

  const info = (
    <ProductInfo
      attributes={attributes}
      density={density}
      description={product.description}
      messages={messages.info}
      ratingAvg={product.ratingAvg}
      ratingCount={product.ratingCount}
    />
  )

  const gallery = (
    <ProductGallery
      images={product.images}
      messages={messages.gallery}
      productName={product.name}
    />
  )

  return (
    <>
      <PageContainer className="flex flex-col gap-6 py-6">
        {/*
          The minimal step is one column and a long scroll — image first, at full
          width. The other two put the gallery beside the summary; the maximal
          step adds a third column for the information that would otherwise be
          below the fold.
        */}
        {density === 1 ? (
          <div className="flex flex-col gap-6">
            {gallery}
            {summary}
            {band === 'base' ? null : controls}
            {info}
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            <div className="min-w-0">{gallery}</div>
            <div className="flex min-w-0 flex-col gap-6">
              {summary}
              {band === 'base' ? null : controls}
              {density === 2 ? info : null}
            </div>
            {density === 3 ? <div className="min-w-0 xl:col-span-1">{info}</div> : null}
          </div>
        )}
      </PageContainer>

      {band === 'base' ? (
        <div className="bg-surface border-border sticky bottom-0 z-20 border-t px-4 py-3">
          <PurchaseControls
            compact
            messages={messages.purchase}
            onQuantityChange={setQuantity}
            optionMessages={messages.options}
            product={product}
            quantity={quantity}
            variant={variant}
          />
        </div>
      ) : null}
    </>
  )
}
