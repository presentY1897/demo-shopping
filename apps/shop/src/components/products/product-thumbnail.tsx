'use client'

import { productImageUrl } from '@/lib/products/seed-image-url'
import { useState } from 'react'

/** Keep order snapshots intact; a failed URL gets a placeholder, never a different product image. */
export function ProductThumbnail({
  src,
  className = '',
}: {
  readonly src: string | null | undefined
  readonly className?: string
}) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!src?.trim() || failed === src)
    return (
      <span
        aria-hidden="true"
        className={`bg-surface-muted text-fg-subtle flex items-center justify-center ${className}`}
      >
        <svg
          aria-hidden="true"
          className="size-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="m3 17 5-5 4 4 3-3 6 6" />
          <circle cx="15" cy="8" r="2" />
        </svg>
      </span>
    )
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Snapshot URLs may belong to historical external hosts.
    <img
      alt=""
      className={`object-cover ${className}`}
      src={productImageUrl(src)}
      onError={() => setFailed(src)}
      loading="lazy"
      decoding="async"
    />
  )
}
