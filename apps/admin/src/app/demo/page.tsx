import type { Metadata } from 'next'

import { PlaceholderScreen } from '@/components/placeholder-screen'
import { screenTitle } from '@/messages'

const title = screenTitle('/demo')

export const metadata: Metadata = { title }

/** `/demo` — the sidebar's destination. TASK-0096 replaces this file. */
export default function Page() {
  return <PlaceholderScreen title={title} />
}
