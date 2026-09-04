import type { Metadata } from 'next'

import { PlaceholderScreen } from '@/components/placeholder-screen'
import { screenTitle } from '@/messages'

const title = screenTitle('/commissions')

export const metadata: Metadata = { title }

/** `/commissions` — the sidebar's destination. TASK-0079 replaces this file. */
export default function Page() {
  return <PlaceholderScreen title={title} />
}
