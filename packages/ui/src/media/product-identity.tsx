import type { ReactNode } from 'react'
import { ProductThumbnail } from './product-thumbnail'

/** A product's existing text remains the accessible name; the image is decorative. */
export function ProductIdentity({
  src,
  children,
}: {
  readonly src: string | null | undefined
  readonly children: ReactNode
}) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <ProductThumbnail src={src} className="size-12 shrink-0 rounded" />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  )
}
