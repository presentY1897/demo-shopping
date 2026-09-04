import { PageHeader } from '@shopping/ui/console'
import type { Metadata } from 'next'

import { SellerReviewWorkspace } from '@/components/sellers/seller-review-workspace'
import { messagesFor } from '@/messages'

const messages = messagesFor()

export const metadata: Metadata = {
  title: messages.sellers.title,
  description: messages.sellers.description,
}

/**
 * `/sellers` — the seller onboarding review queue (TASK-0110).
 *
 * Static, like the console's other pages: nothing is awaited here, so the shell
 * is prerendered and the queue is fetched by the client boundary below
 * (TASK-0101 4.3). A server render that awaited the API would send no markup at
 * all for as long as a cold instance takes to wake, which is up to ninety
 * seconds.
 *
 * The route also belongs to M12 (개별 수수료율) and M14 (계정·매출) in
 * `docs/design/pages.md`; both add to this screen rather than replacing it.
 */
export default function SellersPage() {
  const { sellers, errors, errorNotice } = messagesFor()

  return (
    <>
      <PageHeader description={sellers.description} title={sellers.title} />

      <SellerReviewWorkspace errors={errors} messages={sellers} notice={errorNotice} />
    </>
  )
}
