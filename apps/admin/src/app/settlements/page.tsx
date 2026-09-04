import type { Metadata } from 'next'

import { PlaceholderScreen } from '@/components/placeholder-screen'
import { screenTitle } from '@/messages'

const title = screenTitle('/settlements')

export const metadata: Metadata = { title }

/** `/settlements` — the sidebar's destination. TASK-0081 replaces this file. */
export default function Page() {
  return <PlaceholderScreen title={title} />
}
