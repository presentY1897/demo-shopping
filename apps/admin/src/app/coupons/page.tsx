import type { Metadata } from 'next'

import { PlaceholderScreen } from '@/components/placeholder-screen'
import { screenTitle } from '@/messages'

const title = screenTitle('/coupons')

export const metadata: Metadata = { title }

/** `/coupons` — the sidebar's destination. TASK-0073 replaces this file. */
export default function Page() {
  return <PlaceholderScreen title={title} />
}
