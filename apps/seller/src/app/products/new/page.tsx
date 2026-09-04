import type { Metadata } from 'next'

import { PlaceholderScreen } from '@/components/placeholder-screen'
import { messagesFor } from '@/messages'

const { productNew } = messagesFor().placeholder

export const metadata: Metadata = { title: productNew }

/**
 * `/products/new` — the one route below a menu entry.
 *
 * It exists so that "a screen with no entry of its own still marks the section
 * it belongs to" (F2) is something a browser can be pointed at, rather than a
 * rule only a unit test has seen. TASK-0114 replaces this file.
 */
export default function Page() {
  return <PlaceholderScreen title={productNew} />
}
