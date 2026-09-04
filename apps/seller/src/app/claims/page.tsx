import type { Metadata } from 'next'

import { PlaceholderScreen } from '@/components/placeholder-screen'
import { screenTitle } from '@/messages'

const title = screenTitle('/claims')

export const metadata: Metadata = { title }

/** `/claims` — the sidebar's destination. TASK-0070 replaces this file. */
export default function Page() {
  return <PlaceholderScreen title={title} />
}
