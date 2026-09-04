import type { Metadata } from 'next'

import { ProductEditor } from '@/components/products/product-editor'
import { messagesFor } from '@/messages'

const title = messagesFor().products.editTitle

export const metadata: Metadata = {
  title,
  description: messagesFor().products.editDescription,
}

/**
 * `/products/[id]/edit` — 상품 수정 (TASK-0114).
 *
 * `params` is awaited and the id handed down as a prop rather than read from
 * `useParams()` in the client boundary below. Two reasons, and the second is
 * the one that matters: a client component that fetches its own route parameter
 * cannot be rendered by a spec without a router, so every test of this screen
 * would start by mocking Next's navigation — and a screen whose id arrives as a
 * prop is a screen whose "no such listing" branch is one render away
 * (`apps/admin` reached the same conclusion in TASK-0110).
 *
 * Nothing else is awaited: the listing itself is fetched by the client
 * boundary, so the heading is produced whether or not the API is awake.
 */
export default async function Page({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}) {
  const { id } = await params

  return <ProductEditor productId={id} title={title} />
}
