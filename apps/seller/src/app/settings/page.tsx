import type { Metadata } from 'next'

import { StoreOnboarding } from '@/components/store/store-onboarding'
import { screenTitle } from '@/messages'

const title = screenTitle('/settings')

export const metadata: Metadata = { title }

/**
 * `/settings` — 스토어 설정 (TASK-0109).
 *
 * The same screen as `/apply` and deliberately so: the fields a store is
 * described by do not change with its status, and two components would be two
 * sets of rules to keep in step (TASK-0026·0027 were split that way, which is
 * what D-208 undid).
 *
 * What differs is the way in. This route is behind `ConsoleGuard`, so whoever
 * reaches it holds `SELLER_OWNER` — an approved or a suspended store. An account
 * with no store at all is a state the guard should have caught, so the screen
 * points at `/apply` rather than offering the application form a second time.
 *
 * 배송 정책 joins these fields in M09 (`docs/design/pages.md` 2장).
 */
export default function Page() {
  return <StoreOnboarding surface="settings" title={title} />
}
