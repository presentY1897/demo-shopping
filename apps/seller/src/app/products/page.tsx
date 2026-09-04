import type { Metadata } from 'next'

import { PlaceholderScreen } from '@/components/placeholder-screen'
import { screenTitle } from '@/messages'

const title = screenTitle('/products')

export const metadata: Metadata = { title }

/** `/products` — the sidebar's destination. TASK-0116 replaces this file. */
export default function Page() {
  return <PlaceholderScreen title={title} />
}
