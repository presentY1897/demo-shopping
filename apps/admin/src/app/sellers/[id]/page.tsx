import { PageHeader } from '@shopping/ui/console'
import type { Metadata } from 'next'

import { SellerReviewDetailWorkspace } from '@/components/sellers/seller-review-detail-workspace'
import { messagesFor } from '@/messages'

const messages = messagesFor()

export const metadata: Metadata = {
  title: messages.sellers.detail.applicationTitle,
  description: messages.sellers.description,
}

/**
 * `/sellers/[id]` — one application, in full (TASK-0110).
 *
 * `params` is awaited and the id handed down as a prop rather than read from
 * `useParams()` in the boundary below. Two reasons, and the second is the one
 * that matters: a client component that fetches its own route parameter cannot
 * be rendered by a spec without a router, so every test of this screen would
 * start by mocking Next's navigation — and a screen whose id arrives as a prop
 * is a screen whose "no such application" branch is one render away.
 *
 * Nothing else is awaited: the application itself is fetched by the client
 * boundary, so the heading is produced whether or not the API is awake
 * (TASK-0101 4.3).
 */
export default async function SellerReviewPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}) {
  const { id } = await params
  const { sellers, errors, errorNotice } = messagesFor()

  return (
    <>
      <PageHeader description={sellers.description} title={sellers.title} />

      <SellerReviewDetailWorkspace
        errors={errors}
        messages={sellers}
        notice={errorNotice}
        sellerId={id}
      />
    </>
  )
}
