import type { Metadata } from 'next'

import { PlaceholderScreen } from '@/components/placeholder-screen'
import { screenTitle } from '@/messages'

const title = screenTitle('/orders')

export const metadata: Metadata = { title }

/** `/orders` — the sidebar's destination. TASK-0095 replaces this file. */
export default function Page() {
  return <PlaceholderScreen title={title} />
}
