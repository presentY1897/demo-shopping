'use client'

import { uploadContentTypes } from '@shopping/shared'
import { Button, ErrorNotice, ImageDropZone, ImageUploadList } from '@shopping/ui/components'
import { useEffect } from 'react'

import { getApiClient } from '@/lib/api'
import type { ApiFailureReason } from '@/lib/api-failure'
import type { ErrorMessages } from '@/lib/errors'
import type { ImageUploadMessages } from '@/messages'
import { useImageUpload } from '@/lib/uploads/use-image-upload'
import type { ImageEncoder } from '@/lib/uploads/prepare-image'
import type { UploadTransport } from '@/lib/uploads/storage-transport'

/**
 * The product image widget (TASK-0033).
 *
 * The whole screen-facing surface of this TASK: a drop zone, a gallery in the
 * order the images will appear, and one sentence per row when something goes
 * wrong. TASK-0114 mounts this inside the product form and reads
 * {@link ProductImageUploaderProps.onChange} into the save request; until then
 * `/components/image-upload` is where it can be operated.
 *
 * **Every string arrives from the catalog.** Nothing here decides wording, which
 * is what lets `packages/ui` stay free of Korean and lets the same widget be
 * reused by the review-photo screen (M13) with its own copy.
 */

export interface ProductImageUploaderProps {
  /** The store the objects belong to. The API checks it against the caller. */
  readonly sellerId: string
  readonly messages: ImageUploadMessages
  /** `code` to sentence, for a refusal the API named (TASK-0117). */
  readonly errors: ErrorMessages
  /** Sentences for the failures where the API never answered. */
  readonly apiFailures: Readonly<Record<ApiFailureReason, string>>
  /**
   * The gallery, in order, whenever it changes.
   *
   * Only uploaded images — a row still on its way has no URL, and one that
   * failed must not slip into a saved product as a silent gap.
   */
  readonly onChange?: (images: readonly { url: string }[]) => void
  /** Test seams. The browser implementations are the defaults. */
  readonly encoder?: ImageEncoder
  readonly transport?: UploadTransport
  readonly maxImages?: number
}

export function ProductImageUploader({
  sellerId,
  messages,
  errors,
  apiFailures,
  onChange,
  encoder,
  transport,
  maxImages,
}: ProductImageUploaderProps) {
  const upload = useImageUpload({
    client: getApiClient,
    encoder,
    maxImages,
    messages: { errors, failures: messages.failures, transport: apiFailures },
    sellerId,
    transport,
  })

  const { images } = upload

  useEffect(() => {
    onChange?.(images)
  }, [images, onChange])

  // Only a 5xx produces one, so this panel appears for a failure nobody on this
  // screen can fix and never beside a message whose next action is already
  // obvious (TASK-0117 4.4).
  const noticeId = upload.notice?.requestId ?? null

  return (
    <section aria-labelledby="product-images-heading" className="flex flex-col gap-3">
      <div>
        <h2 className="text-fg text-base font-medium" id="product-images-heading">
          {messages.title}
        </h2>
        <p className="text-fg-muted mt-1 text-sm">{messages.description}</p>
      </div>

      <ImageDropZone
        accept={uploadContentTypes.join(',')}
        description={upload.full ? messages.fullNotice : messages.hint}
        disabled={upload.full}
        dropLabel={messages.dropLabel}
        label={messages.pickLabel}
        multiple
        onFiles={upload.add}
      />

      {upload.rejected.length === 0 ? null : (
        <div
          className="border-warning bg-warning-surface text-fg rounded-md border p-3 text-sm"
          role="status"
        >
          <p className="font-medium">{messages.rejectedTitle}</p>
          <ul className="mt-1 flex flex-col gap-1">
            {upload.rejected.map((rejection) => (
              <li className="flex flex-wrap gap-2" key={`${rejection.name}-${rejection.reason}`}>
                <span className="font-medium">{rejection.name}</span>
                <span>{messages.rejections[rejection.reason]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {noticeId === null ? null : (
        <ErrorNotice
          copiedLabel={messages.copiedLabel}
          copyLabel={messages.copyLabel}
          description={upload.notice?.message}
          requestId={noticeId}
          requestIdHint={messages.requestIdHint}
          requestIdLabel={messages.requestIdLabel}
          title={messages.noticeTitle}
        />
      )}

      {upload.items.length === 0 ? (
        <p className="border-border text-fg-muted rounded-lg border border-dashed p-6 text-center text-sm">
          {messages.emptyDescription}
        </p>
      ) : (
        <ImageUploadList
          items={upload.items}
          labels={messages.list}
          onCancel={upload.cancel}
          onMakePrimary={upload.makePrimary}
          onMove={upload.move}
          onRemove={upload.remove}
          onRetry={upload.retry}
        />
      )}

      {upload.hasFailures ? (
        <div>
          <Button onClick={upload.retryFailed} variant="outline">
            {messages.retryAllLabel}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
