'use client'

import type { ProductImage, ProductImageInput } from '@shopping/shared'
import { Button } from '@shopping/ui/components'
import { useCallback, useId, useMemo, useState } from 'react'

import { ProductImageUploader } from '@/components/product-images/product-image-uploader'
import { useAuth } from '@/lib/auth/auth-context'
import { fill } from '@/lib/products/product-form'
import type { Messages } from '@/messages'

/**
 * The gallery, as the save request carries it (TASK-0114 4장, TASK-0033 F3·F4).
 *
 * **The widget only knows about uploads.** It manages a queue of files it is
 * given and reports the URLs it produced; it has never heard of the images a
 * stored listing already has. So a screen that handed its answer straight to
 * the save request would send an empty gallery the moment it mounted — and
 * editing a product to change its price would silently delete its photographs.
 * A spec caught exactly that.
 *
 * So the gallery is **what is stored, plus what was just uploaded**, and the
 * stored half is drawn here with a way to take one out. Reordering across the
 * two halves is not offered: the widget owns the order of its own rows, and a
 * single ordering over both is the 순서 · 대표 확인 화면 that TASK-0033 F3·F4
 * handed to TASK-0043 · 0116 (`pages.md` 판매자 절).
 *
 * **The store comes from the session, not from a prop the form could get
 * wrong.** `presignUpload` is authorised against the caller's own scope, so a
 * mismatched id is a 403 rather than a mistake, and the product write refuses a
 * key belonging to another store on top of that (TASK-0113 F14).
 *
 * **Order is the model.** The first image is the thumbnail; there is no
 * separate flag, because the API stores the request array's index as
 * `sortOrder` and every read replays it.
 */

export interface ProductImageFieldProps {
  readonly messages: Messages
  readonly onChange: (images: readonly ProductImageInput[]) => void
  /** The gallery the listing already has. Empty while creating. */
  readonly stored: readonly ProductImage[]
  /** The stored listing's owner, when there is one. Falls back to the session. */
  readonly sellerId: string | null
}

function inputOf(image: ProductImage): ProductImageInput {
  return { url: image.url, ...(image.alt === null ? {} : { alt: image.alt }) }
}

export function ProductImageField({
  messages,
  onChange,
  stored,
  sellerId,
}: ProductImageFieldProps) {
  const { subject } = useAuth()
  const store = sellerId ?? subject?.sellerId ?? null
  const headingId = useId()
  const copy = messages.products.gallery

  /** The stored images still in the gallery, in their stored order. */
  const [kept, setKept] = useState<readonly ProductImage[]>(stored)
  const [uploaded, setUploaded] = useState<readonly ProductImageInput[]>([])

  const report = useCallback(
    (next: readonly ProductImage[], added: readonly ProductImageInput[]) => {
      onChange([...next.map(inputOf), ...added])
    },
    [onChange],
  )

  const handleUploaded = useCallback(
    (images: readonly { url: string }[]) => {
      const added = images.map((image) => ({ url: image.url }))

      setUploaded(added)
      setKept((current) => {
        report(current, added)

        return current
      })
    },
    [report],
  )

  const remove = useCallback(
    (id: string) => {
      setKept((current) => {
        const next = current.filter((image) => image.id !== id)

        report(next, uploaded)

        return next
      })
    },
    [report, uploaded],
  )

  const rows = useMemo(
    () =>
      kept.map((image, index) => ({
        image,
        label: fill(copy.storedLabel, { index: String(index + 1) }),
      })),
    [copy.storedLabel, kept],
  )

  // Nothing to upload against. Only reachable before the session settles or for
  // an account with no store, and the console guard has already turned the
  // second one away — so this is a frame, not a state worth wording.
  if (store === null) return null

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? null : (
        <section aria-labelledby={headingId} className="flex flex-col gap-2">
          <h2 className="text-fg text-base font-medium" id={headingId}>
            {copy.storedTitle}
          </h2>
          <p className="text-fg-muted text-sm">{copy.storedDescription}</p>

          <ul className="flex flex-wrap gap-3">
            {rows.map(({ image, label }) => (
              <li className="flex flex-col items-center gap-1" key={image.id}>
                {/*
                  A plain `<img>` for the reason `ProductPreview` gives: the URL
                  is whatever was uploaded, and `next/image` would need a
                  `remotePatterns` entry per storage host.
                */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt={image.alt ?? label}
                  className="border-border h-24 w-20 rounded-md border object-cover"
                  src={image.url}
                />
                <Button
                  onClick={() => {
                    remove(image.id)
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {fill(copy.removeLabel, { index: label })}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ProductImageUploader
        apiFailures={messages.apiFailures}
        errors={messages.errors}
        messages={messages.imageUpload}
        onChange={handleUploaded}
        sellerId={store}
      />
    </div>
  )
}
