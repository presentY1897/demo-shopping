import type { Metadata } from 'next'

import { StoreOnboarding } from '@/components/store/store-onboarding'
import { messagesFor } from '@/messages'

const title = messagesFor().store.applyTitle

export const metadata: Metadata = { title }

/**
 * `/apply` — 입점 신청, 재신청, and the status of an application already made
 * (TASK-0109).
 *
 * **Reachable without `SELLER_OWNER`**, which is the one thing that makes it
 * work: the person filling it in is not a seller yet. `console-access.ts` has
 * listed it under `SIGNED_IN_ONLY_ROUTES` since TASK-0023, ahead of the screen
 * existing; this is the screen.
 *
 * Nothing is awaited here, so the heading is prerendered and the read of
 * `GET /sellers/me` happens in the browser (TASK-0101 4.3).
 */
export default function Page() {
  return <StoreOnboarding surface="apply" title={title} />
}
