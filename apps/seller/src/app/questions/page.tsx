import type { Metadata } from 'next'

import { PlaceholderScreen } from '@/components/placeholder-screen'
import { screenTitle } from '@/messages'

const title = screenTitle('/questions')

export const metadata: Metadata = { title }

/** `/questions` — the sidebar's destination. TASK-0088 replaces this file. */
export default function Page() {
  return <PlaceholderScreen title={title} />
}
