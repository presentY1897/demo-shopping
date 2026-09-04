import type { Metadata } from 'next'

import { PlaceholderScreen } from '@/components/placeholder-screen'
import { screenTitle } from '@/messages'

const title = screenTitle('/users')

export const metadata: Metadata = { title }

/** `/users` — the sidebar's destination. TASK-0093 replaces this file. */
export default function Page() {
  return <PlaceholderScreen title={title} />
}
