import type { Metadata } from 'next'

import { ProductEditor } from '@/components/products/product-editor'
import { messagesFor } from '@/messages'

const title = messagesFor().products.newTitle

export const metadata: Metadata = {
  title,
  description: messagesFor().products.newDescription,
}

/**
 * `/products/new` — 상품 등록 (TASK-0114).
 *
 * Nothing is awaited here, so the heading is prerendered and every read the
 * editor needs — the category tree, the chosen category's definitions — happens
 * in the browser (TASK-0101 4.3). That is also what gives the screen its
 * loading state rather than a blank first paint.
 *
 * `productId` is `null` rather than absent, so the editor's two entrances are
 * one prop apart and neither can drift into a second implementation.
 */
export default function Page() {
  return <ProductEditor productId={null} title={title} />
}
