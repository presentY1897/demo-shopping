import type { Metadata } from 'next'

import { PlaceholderScreen } from '@/components/placeholder-screen'
import { screenTitle } from '@/messages'

const title = screenTitle('/reviews')

export const metadata: Metadata = { title }

/** `/reviews` — the sidebar's destination. TASK-0085 replaces this file. */
export default function Page() {
  return <PlaceholderScreen title={title} />
}
