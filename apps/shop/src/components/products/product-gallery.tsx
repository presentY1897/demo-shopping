'use client'

/**
 * 이미지 갤러리 — 썸네일 · 확대 · 스와이프 (TASK-0043 F5).
 *
 * **The swipe is the scroller, not a gesture handler.** A horizontal
 * `overflow-x` strip with CSS scroll snapping already does what a phone needs:
 * momentum, rubber-banding, the right feel at the ends, and the accessibility
 * of a scrollable region — for free, and correctly. A hand-rolled
 * `touchstart`/`touchmove` implementation would be a worse copy of it, and it
 * would fight the browser on every OS that disagrees with its thresholds.
 *
 * Which image is showing is therefore **observed**, not stored: the scroller is
 * the source of truth, the thumbnails scroll it, and the index follows. Storing
 * it as well would give the strip two positions to be at.
 *
 * Zoom is a class swap on the image rather than a modal. A lightbox is a focus
 * trap, an Escape handler and a second copy of the gallery inside it; what a
 * shopper wants here is to see the weave, and `scale` on a container that scrolls
 * gives them that with the keyboard already working.
 */

import { IconButton } from '@shopping/ui/components'
import type { ProductImage } from '@shopping/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ProductGalleryMessages } from '@/messages'

export interface ProductGalleryProps {
  readonly images: readonly ProductImage[]
  readonly productName: string
  readonly messages: ProductGalleryMessages
  /** Rendered in place of `<img>`, so the page can pass `next/image`. */
  readonly renderImage?: (image: { readonly src: string; readonly alt: string }) => React.ReactNode
}

export function ProductGallery({
  images,
  productName,
  messages,
  renderImage,
}: ProductGalleryProps) {
  const stripRef = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const [zoomed, setZoomed] = useState(false)

  /**
   * Moves the strip by writing `scrollLeft`, not by calling `scrollTo`.
   *
   * The smoothness is `scroll-smooth` on the element, which is where it belongs:
   * a person who has asked their system for reduced motion gets an instant jump
   * from the same class, and `behavior: 'smooth'` in script would override that.
   * It is also the only form jsdom implements — `Element.scrollTo` throws there,
   * so a thumbnail click was an unhandled error in every spec that made one.
   */
  const scrollTo = useCallback((wanted: number) => {
    const strip = stripRef.current

    if (strip === null) return

    strip.scrollLeft = strip.clientWidth * wanted
  }, [])

  useEffect(() => {
    const strip = stripRef.current

    if (strip === null) return

    function onScroll(): void {
      if (strip === null) return

      // Rounded rather than floored: mid-swipe the offset is fractional, and
      // flooring would report the previous image until the snap completed.
      setIndex(Math.round(strip.scrollLeft / Math.max(strip.clientWidth, 1)))
    }

    strip.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      strip.removeEventListener('scroll', onScroll)
    }
  }, [])

  if (images.length === 0) {
    return (
      <div className="bg-surface-muted text-fg-subtle flex aspect-square w-full items-center justify-center rounded-md text-sm">
        {messages.empty}
      </div>
    )
  }

  const altOf = (image: ProductImage, position: number): string =>
    image.alt ??
    messages.imageAlt.replace('{name}', productName).replace('{index}', String(position + 1))

  return (
    <section aria-label={messages.label} className="flex flex-col gap-2">
      <div className="relative">
        <div
          className="scrollbar-none flex w-full snap-x snap-mandatory scroll-smooth overflow-x-auto rounded-md motion-reduce:scroll-auto"
          ref={stripRef}
        >
          {images.map((image, position) => (
            <div className="w-full shrink-0 snap-center" key={image.id}>
              <div className="bg-surface-muted aspect-square w-full overflow-hidden">
                {renderImage === undefined ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the page passes `next/image`; this is the fallback for a spec and for Storybook.
                  <img
                    alt={altOf(image, position)}
                    className={
                      zoomed
                        ? 'size-full origin-center scale-150 object-cover transition-transform'
                        : 'size-full object-cover transition-transform'
                    }
                    src={image.url}
                  />
                ) : (
                  renderImage({ src: image.url, alt: altOf(image, position) })
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="absolute inset-x-2 top-1/2 flex -translate-y-1/2 justify-between">
          <IconButton
            className="bg-surface/85"
            disabled={index === 0}
            label={messages.previous}
            onClick={() => {
              scrollTo(index - 1)
            }}
            size="sm"
            variant="ghost"
          >
            <span aria-hidden="true">‹</span>
          </IconButton>
          <IconButton
            className="bg-surface/85"
            disabled={index >= images.length - 1}
            label={messages.next}
            onClick={() => {
              scrollTo(index + 1)
            }}
            size="sm"
            variant="ghost"
          >
            <span aria-hidden="true">›</span>
          </IconButton>
        </div>

        <IconButton
          aria-pressed={zoomed}
          className="bg-surface/85 absolute right-2 bottom-2"
          label={zoomed ? messages.zoomOut : messages.zoomIn}
          onClick={() => {
            setZoomed((held) => !held)
          }}
          size="sm"
          variant="ghost"
        >
          <span aria-hidden="true">{zoomed ? '−' : '+'}</span>
        </IconButton>
      </div>

      <p aria-live="polite" className="sr-only">
        {messages.position
          .replace('{index}', String(index + 1))
          .replace('{total}', String(images.length))}
      </p>

      {images.length < 2 ? null : (
        <ul aria-label={messages.thumbnailsLabel} className="flex gap-2 overflow-x-auto">
          {images.map((image, position) => (
            <li key={image.id}>
              <button
                aria-current={position === index ? 'true' : undefined}
                className={
                  position === index
                    ? 'border-primary size-16 overflow-hidden rounded-md border-2'
                    : 'border-border size-16 overflow-hidden rounded-md border'
                }
                onClick={() => {
                  scrollTo(position)
                }}
                type="button"
              >
                <span className="sr-only">
                  {messages.thumbnailLabel.replace('{index}', String(position + 1))}
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element -- a 64px thumbnail; `next/image` for these would be sixteen requests for nothing. */}
                <img alt="" aria-hidden="true" className="size-full object-cover" src={image.url} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
