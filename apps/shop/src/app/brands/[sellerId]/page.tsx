import { ApiClientError } from '@shopping/shared'
import { Button } from '@shopping/ui/components'
import { PageContainer } from '@shopping/ui/layout'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { BrandProducts } from '@/components/brand/brand-products'
import { fetchStorefrontSeller } from '@/lib/storefront/seller-api'
import { messagesFor } from '@/messages'

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
    return await fetchStorefrontSeller(id)
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

  return {
    title: copy.metaTitle.replace('{brand}', seller.brandName),
    description: seller.introduction ?? copy.metaDescription.replace('{brand}', seller.brandName),
    alternates: { canonical: `/brands/${seller.id}` },
  }
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

        <div className="ml-auto flex shrink-0 flex-col items-end gap-1">
          {/*
            Inert until M13. Shown and disabled with a reason rather than hidden
            — TASK-0023 4장: the point of the demo is that the feature is visible.
            `aria-disabled` keeps the tab stop, so the reason below is reachable.
          */}
          <Button
            aria-disabled
            onClick={(event) => {
              event.preventDefault()
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            {copy.follow}
          </Button>
          <p className="text-fg-subtle text-xs">{copy.followComingSoon}</p>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-fg text-lg font-semibold">{copy.productsTitle}</h2>
        <BrandProducts messages={messages.search} sellerId={seller.id} />
      </section>
    </PageContainer>
  )
}
