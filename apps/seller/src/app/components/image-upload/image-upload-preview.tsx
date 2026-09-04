'use client'

import { useState } from 'react'

import { ProductImageUploader } from '@/components/product-images/product-image-uploader'
import type { ApiFailureReason } from '@/lib/api-failure'
import type { ErrorMessages } from '@/lib/errors'
import type { ImageUploadMessages } from '@/messages'

/**
 * The widget, plus the value it produces (TASK-0033 4.11).
 *
 * Showing the gallery array is the point of this page rather than decoration:
 * what TASK-0114 will send is `[{ url }]` **in gallery order**, and the only way
 * to see that reordering and "make primary" really change the request — not just
 * the rows — is to print it.
 */

export interface ImageUploadPreviewProps {
  readonly sellerId: string
  readonly messages: ImageUploadMessages
  readonly errors: ErrorMessages
  readonly apiFailures: Readonly<Record<ApiFailureReason, string>>
}

export function ImageUploadPreview({
  sellerId,
  messages,
  errors,
  apiFailures,
}: ImageUploadPreviewProps) {
  const [images, setImages] = useState<readonly { url: string }[]>([])

  return (
    <div className="flex flex-col gap-6">
      <ProductImageUploader
        apiFailures={apiFailures}
        errors={errors}
        messages={messages}
        onChange={setImages}
        sellerId={sellerId}
      />

      <section aria-labelledby="upload-output-heading" className="flex flex-col gap-2">
        <h2 className="text-fg text-base font-medium" id="upload-output-heading">
          {messages.preview.outputTitle}
        </h2>

        {images.length === 0 ? (
          <p className="text-fg-muted text-sm">{messages.preview.outputEmpty}</p>
        ) : (
          <ol className="border-border bg-surface-sunken text-fg flex flex-col gap-1 overflow-x-auto rounded-md border p-3 font-mono text-xs">
            {images.map((image, index) => (
              <li key={image.url}>
                {index + 1}. {image.url}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
