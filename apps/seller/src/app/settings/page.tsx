import type { Metadata } from 'next'

import { PlaceholderScreen } from '@/components/placeholder-screen'
import { screenTitle } from '@/messages'

const title = screenTitle('/settings')

export const metadata: Metadata = { title }

/** `/settings` — the sidebar's destination. TASK-0109 replaces this file. */
export default function Page() {
  return <PlaceholderScreen title={title} />
}
