'use client'

import { productImageUrl } from './product-image-url'
import { useImageFailure } from './use-image-failure'

/** Keep order snapshots intact; a failed URL gets a placeholder, never a different product image. */
export function ProductThumbnail({
  src,
  className = '',
  alt = '',
}: {
  readonly src: string | null | undefined
  readonly alt?: string
  readonly className?: string
}) {
  const { unavailable, markFailed } = useImageFailure()
  if (unavailable(src))
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
      alt={alt}
      className={`object-cover ${className}`}
      src={productImageUrl(src?.trim() ?? '')}
      onError={() => markFailed(src)}
      loading="lazy"
      decoding="async"
    />
  )
}
