import { PageContainer } from '@shopping/ui/layout'
import type { Metadata } from 'next'

import { NoPermissionScreen } from '@/components/auth/no-permission-screen'
import { messagesFor } from '@/messages'

const messages = messagesFor()

export const metadata: Metadata = { title: messages.auth.guard.title }

/**
 * `/no-permission` — signed in, and still nothing to show (TASK-0023 F7).
 *
 * **It says one thing, not three.** Whether this account never applied, is being
 * reviewed, or was rejected is a distinction the session cannot make: it carries
 * `roles` and `sellerId` and no `Seller.status`, and the API that will carry one
 * is TASK-0108's. Guessing from `sellerId` would tell a rejected applicant that
 * they are under review — TASK-0023 4장 · R2 records the decision, and TASK-0109
 * picks the distinction up with the contract it needs.
 */
export default function NoPermissionPage() {
  return (
    <PageContainer className="flex max-w-lg flex-col py-10">
      <NoPermissionScreen messages={messages.auth} />
    </PageContainer>
  )
}
