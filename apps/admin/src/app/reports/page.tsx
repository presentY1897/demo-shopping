import type { Metadata } from 'next'

import { PlaceholderScreen } from '@/components/placeholder-screen'
import { screenTitle } from '@/messages'

const title = screenTitle('/reports')

export const metadata: Metadata = { title }

/** `/reports` — the sidebar's destination. TASK-0091 replaces this file. */
export default function Page() {
  return <PlaceholderScreen title={title} />
}
