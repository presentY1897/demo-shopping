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
import { useBuyNow } from '@/lib/checkout/use-buy-now'
import { PageContainer, useViewportBand } from '@shopping/ui/layout'
import Link from 'next/link'
import { useState } from 'react'

import type { Selection } from '@/lib/products/variant-selection'
import { useFreshDetail } from '@/lib/products/use-fresh-detail'
import { choose, displayPrice, selectedVariant } from '@/lib/products/variant-selection'
import { imagesForSelection } from '@/lib/products/selection-images'
import { useAddToCart } from '@/lib/cart/use-add-to-cart'
import { useRecordView } from '@/lib/collections/use-recently-viewed'
import type {
  CartMessages,
  CollectionMessages,
  ProductDetailMessages,
  RefusalMessages,
  ReportMessages,
} from '@/messages'

import { FollowButton } from '../collections/follow-button'
import { RecentlyViewedStrip } from '../collections/recently-viewed-strip'
import { WishlistButton } from '../collections/wishlist-button'
import { ProductQuestions } from '../questions/product-questions'
import { ProductReviews } from '../reviews/product-reviews'

import { OptionPicker } from './option-picker'
import { ProductGallery } from './product-gallery'
import { ProductInfo } from './product-info'
import { PurchaseControls } from './purchase-controls'

/** DECISIONS 1장: 한국어·KRW 우선. */
const CURRENCY = 'KRW'

/** 재고가 이 아래로 내려가면 「N개 남음」을 붙인다. 맥시멀 전용. */
const LOW_STOCK = 10

export function ProductDetail({
  collections,
  detail: cached,
  messages,
  cartMessages,
  refusals,
  report,
}: {
  readonly collections: CollectionMessages
  readonly detail: ProductDetailResponse
  readonly messages: ProductDetailMessages
  readonly cartMessages: CartMessages
  readonly refusals: RefusalMessages
  readonly report: ReportMessages
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
  const cart = useAddToCart()
  const direct = useBuyNow()

  /**
   * 로그인하지 않은 사람의 열람 이력 (TASK-0087 F6).
   *
   * **로그인한 사람의 것은 서버가 남긴다** — 상세 조회 뒤에 비동기로(4장). 여기서
   * 함께 적으면 같은 조회가 두 곳에 기록되고, 로그인 다음 병합에서 그 둘이 다시
   * 만난다. 그래서 이 훅은 익명일 때만 적는다.
   */
  useRecordView({
    productId: product.id,
    productName: product.name,
    brandName: seller.brandName,
    thumbnailUrl: product.images[0]?.url ?? null,
    price: product.minPrice,
    viewedAt: new Date().toISOString(),
  })

  const variant = selectedVariant(product, selection)
  const shown = displayPrice(product, variant)
  const listPrice = shown?.listPrice ?? null
  const discount =
    shown === null || listPrice === null || listPrice <= shown.price
      ? null
      : Math.round(((listPrice - shown.price) / listPrice) * 100)

  const controls = (
    <PurchaseControls
      addState={cart.state}
      cartMessages={cartMessages}
      messages={messages.purchase}
      onAddToCart={cart.add}
      onBuyNow={direct.buy}
      buying={direct.opening}
      buyFailed={direct.failed}
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            className="text-fg-muted text-sm underline-offset-2 hover:underline"
            href={`/brands/${seller.id}`}
          >
            {messages.brandLink.replace('{brand}', seller.brandName)}
          </Link>
          {/*
            브랜드 링크 옆이다 (TASK-0089). 팔로우는 **이 브랜드에 대한 일**이지 이
            상품에 대한 일이 아니고, 구매 영역에 두면 담기·사기와 같은 무게로 읽힌다.
          */}
          <FollowButton copy={collections.follow} sellerId={seller.id} />
        </div>
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
              {variant !== null &&
              variant.availableStock > 0 &&
              variant.availableStock <= LOW_STOCK ? (
                <li>
                  <Tag variant="primary">
                    {messages.info.badges.lowStock.replace(
                      '{count}',
                      String(variant.availableStock),
                    )}
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

      {/*
        찜 버튼 (TASK-0086). 옵션 위인 것은 찜이 **조합을 고르기 전에도 할 수 있는
        일**이기 때문이다 — 계약이 상품 단위로 담는다(`POST /me/wishlist/:productId`).
      */}
      <WishlistButton copy={collections.wishlist} productId={product.id} />

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
          {variant.availableStock > 0
            ? ` · ${messages.options.stockLabel.replace('{count}', String(variant.availableStock))}`
            : ''}
        </p>
      )}
    </div>
  )

  const info = (
    <ProductInfo
      shippingFee={seller.shippingFee}
      freeShippingThreshold={seller.freeShippingThreshold}
      attributes={attributes}
      density={density}
      description={product.description}
      messages={messages.info}
    />
  )

  /**
   * 리뷰 (TASK-0084).
   *
   * **격자 밖, 본문 아래 전폭이다.** 밀도 3에서 정보 블록은 세 번째 열로 빠지는데,
   * 리뷰는 그 열에 들어가면 분포 그래프와 사진 갤러리가 카드 폭으로 눌린다 — 그리고
   * 리뷰는 세 단계 모두에서 읽히는 것이지 맥시멀의 부록이 아니다.
   *
   * 집계를 넘기는 이유는 미니멀 단계가 **아무것도 묻지 않기** 때문이다. 상품 상세가
   * 이미 들고 있는 값으로 「4.4 · 리뷰 12건」을 그리고, 펼친 뒤에야 목록을 부른다.
   */
  const reviews = (
    <ProductReviews
      copy={messages.reviews}
      productId={product.id}
      ratingAvg={product.ratingAvg}
      ratingCount={product.ratingCount}
      refusals={refusals}
      report={report}
    />
  )

  /**
   * 문의 (TASK-0088).
   *
   * 리뷰와 같은 자리 — 격자 밖, 본문 아래 전폭이다. 밀도 3에서 정보 블록이 세 번째
   * 열로 빠지는데, 문의 목록이 그 열에 들어가면 답변 상자가 카드 폭으로 눌린다.
   *
   * 다만 **보이는 조건이 리뷰와 반대**다. 리뷰는 세 단계 모두에서 읽히는 것이고
   * (미니멀은 펼쳐서), 문의 목록은 맥시멀에서만 펼쳐진 채로 시작한다 (F6).
   */
  const questions = (
    <ProductQuestions
      copy={messages.questions}
      productId={product.id}
      refusals={refusals}
      report={report}
    />
  )

  const galleryImages = imagesForSelection(product, selection)
  const gallery = (
    <ProductGallery
      key={galleryImages.map((image) => image.id).join(',')}
      images={galleryImages}
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

        {reviews}
        {questions}

        {/*
          최근 본 상품 (TASK-0087). 지금 보고 있는 상품은 빼고 그린다 — 서버가 방금
          기록했거나 브라우저가 방금 적었기 때문에, 빼지 않으면 「최근 본 상품」의 맨
          앞이 지금 보는 상품이 된다.
        */}
        <RecentlyViewedStrip copy={collections.recent} exclude={product.id} />
      </PageContainer>

      {band === 'base' ? (
        <div className="bg-surface border-border sticky bottom-0 z-20 border-t px-4 py-3">
          <PurchaseControls
            addState={cart.state}
            cartMessages={cartMessages}
            compact
            messages={messages.purchase}
            onAddToCart={cart.add}
            onBuyNow={direct.buy}
            buying={direct.opening}
            buyFailed={direct.failed}
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
