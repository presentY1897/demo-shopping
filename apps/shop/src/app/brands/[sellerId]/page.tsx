import { ApiClientError } from '@shopping/shared'
import { PageContainer } from '@shopping/ui/layout'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { BrandProducts } from '@/components/brand/brand-products'
import { FollowButton } from '@/components/collections/follow-button'
import { CATALOGUE_REVALIDATE_SECONDS } from '@/lib/seo/revalidate'
import { fetchStorefrontSeller } from '@/lib/storefront/seller-api'
import { indexedMetadata } from '@/lib/seo/page-metadata'
import { messagesFor } from '@/messages'

/**
 * Next requires this to be a **literal** — an imported constant is rejected with
 * 「Invalid segment configuration export」. So the number is written twice, and
 * `isr-window.spec.ts` is what keeps the two equal: the page's literal is
 * compared against {@link CATALOGUE_REVALIDATE_SECONDS}, which is the value the fetch below asks for.
 */
export const revalidate = 300

/**
 * 브랜드관 (TASK-0044).
 *
 * **Server rendered**, which `docs/design/pages.md` asks of it: the page is
 * indexed and a crawler runs no JavaScript. The store is read with the public
 * client — `GET /sellers/:id` needs no session (4.2) — so the render needs
 * nothing from the browser.
 *
 * A 404 from the API becomes a 404 here, and that covers three cases the API
 * deliberately does not tell apart: a store under review, a suspended one, and
 * an id that never existed.
 *
 * The product list is the search screen's own component with the store pinned.
 */

async function load(id: string) {
  try {
    return await fetchStorefrontSeller(id, { revalidate: CATALOGUE_REVALIDATE_SECONDS })
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound()

    throw error
  }
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly sellerId: string }>
}): Promise<Metadata> {
  const { sellerId } = await params
  const copy = messagesFor().brand
  const { seller } = await load(sellerId)

  return indexedMetadata({
    title: copy.metaTitle.replace('{brand}', seller.brandName),
    description: seller.introduction ?? copy.metaDescription.replace('{brand}', seller.brandName),
    // The id, not the slug (TASK-0102 4.2): moving the URL onto `Seller.slug`
    // would need redirects for the links TASK-0043 already shipped.
    path: `/brands/${seller.id}`,
    ...(seller.logoUrl === null ? {} : { images: [seller.logoUrl] }),
  })
}

export default async function BrandPage({
  params,
}: {
  readonly params: Promise<{ readonly sellerId: string }>
}) {
  const { sellerId } = await params
  const messages = messagesFor()
  const copy = messages.brand
  const { seller } = await load(sellerId)

  return (
    <PageContainer className="flex flex-col gap-6 py-6">
      <div className="flex items-start gap-4">
        {seller.logoUrl === null ? null : (
          // eslint-disable-next-line @next/next/no-img-element -- a store logo from an arbitrary host; `next/image` would need every seller's domain in the config.
          <img
            alt={copy.logoAlt.replace('{brand}', seller.brandName)}
            className="border-border size-16 shrink-0 rounded-md border object-cover"
            src={seller.logoUrl}
          />
        )}

        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-fg text-2xl font-bold">{seller.brandName}</h1>
          <p className="text-fg-muted text-sm">{seller.introduction ?? copy.noIntroduction}</p>
        </div>

        <div className="ml-auto shrink-0">
          {/*
            비활성 버튼이었던 자리를 TASK-0089 가 채웠다. 클라이언트 컴포넌트인 것은
            이 버튼만이 세션을 필요로 하기 때문이고, 그래서 이 페이지는 여전히 서버에서
            렌더된다 — 크롤러가 읽는 것은 위의 브랜드명과 소개다.

            팔로워 수는 **여기서** 넘어간다 (F3 · 4.3). 공개 응답이 그 수를 언제나
            싣고, 그래서 아직 팔로우하지 않은 사람도 로그인하지 않은 사람도 그것을
            본다 — 그 사람이 바로 이 수를 근거로 쓰는 사람이다.
          */}
          <FollowButton
            copy={messages.collections.follow}
            followerCount={seller.followerCount}
            sellerId={seller.id}
          />
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-fg text-lg font-semibold">{copy.productsTitle}</h2>
        <BrandProducts messages={messages.search} sellerId={seller.id} />
      </section>
    </PageContainer>
  )
}
