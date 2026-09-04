import type { Metadata } from 'next'

import { ProductListWorkspace } from '@/components/products/product-list-workspace'
import { messagesFor } from '@/messages'

const title = messagesFor().productList.title

export const metadata: Metadata = {
  title,
  description: messagesFor().productList.description,
}

/**
 * `/products` — 판매자 상품 목록 (TASK-0116).
 *
 * The heading and the filter bar are this server component's; the rows are the
 * client boundary's, fetched in an effect. Nothing is awaited here, so the
 * screen's markup is produced and sent while the API may still be waking — which
 * is what gives the list four states rather than two (P5).
 */
export default function Page() {
  return <ProductListWorkspace title={title} />
}
