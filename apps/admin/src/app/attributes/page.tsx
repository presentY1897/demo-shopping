import type { Metadata } from 'next'

import { PlaceholderScreen } from '@/components/placeholder-screen'
import { screenTitle } from '@/messages'

const title = screenTitle('/attributes')

export const metadata: Metadata = { title }

/** `/attributes` — the sidebar's destination. TASK-0031 replaces this file. */
export default function Page() {
  return <PlaceholderScreen title={title} />
}
