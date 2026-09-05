import type { Metadata } from 'next'
import type { ReactNode } from 'react'

/** 주문서는 한 사람의 것이다 — 색인하지 않는다 (TASK-0102 4장). */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function CheckoutLayout({ children }: { readonly children: ReactNode }) {
  return children
}
