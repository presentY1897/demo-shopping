import type { Metadata } from 'next'

import { StockWorkspace } from '@/components/products/stock-workspace'
import { messagesFor } from '@/messages'

const title = messagesFor().productStock.title

export const metadata: Metadata = {
  title,
  description: messagesFor().productStock.description,
}

/**
 * `/products/[id]/stock` — Variant 별 재고 관리 (TASK-0116).
 *
 * `params` is awaited and the id handed down as a prop rather than read from
 * `useParams()` in the client boundary. A client component that fetches its own
 * route parameter cannot be rendered by a spec without a router, so every test
 * of this screen would start by mocking Next's navigation — the same reasoning
 * the editor page gives (TASK-0114).
 */
export default async function Page({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>
}) {
  const { id } = await params

  return <StockWorkspace productId={id} title={title} />
}
