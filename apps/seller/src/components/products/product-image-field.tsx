'use client'

import type { ProductImageInput } from '@shopping/shared'
import { useCallback } from 'react'

import { useAuth } from '@/lib/auth/auth-context'
import { ProductImageUploader } from '@/components/product-images/product-image-uploader'
import type { Messages } from '@/messages'

/**
 * The gallery, as the save request carries it (TASK-0114 4장, TASK-0033 F3·F4).
 *
 * A thin wrapper and deliberately nothing more: the widget is TASK-0033's and
 * already owns the queue, the presign round trip, the retry and the reordering.
 * What this adds is the one thing the widget cannot know — which store the
 * objects belong to — and the shape the request wants.
 *
 * **The store comes from the session, not from a prop the form could get
 * wrong.** `presignUpload` is authorised against the caller's own scope, so a
 * mismatched id is a 403 rather than a mistake, and the product write refuses a
 * key belonging to another store on top of that (TASK-0113 F14). Reading it
 * once here keeps both from being a question the editor has to answer twice.
 *
 * **Order is the model.** The first image is the thumbnail; there is no
 * separate flag, because the API stores the request array's index as
 * `sortOrder` and every read replays it (`pages.md` 상품 이미지 업로드 규약).
 * So 「대표로 지정」 is a move, and this component passes the array through
 * untouched.
 */

export interface ProductImageFieldProps {
  readonly messages: Messages
  readonly onChange: (images: readonly ProductImageInput[]) => void
  /** The stored listing's owner, when there is one. Falls back to the session. */
  readonly sellerId: string | null
}

export function ProductImageField({ messages, onChange, sellerId }: ProductImageFieldProps) {
  const { subject } = useAuth()
  const store = sellerId ?? subject?.sellerId ?? null

  const handleChange = useCallback(
    (images: readonly { url: string }[]) => {
      onChange(images.map((image) => ({ url: image.url })))
    },
    [onChange],
  )

  // Nothing to upload against. Only reachable before the session settles or for
  // an account with no store, and the console guard has already turned the
  // second one away — so this is a frame, not a state worth wording.
  if (store === null) return null

  return (
    <ProductImageUploader
      apiFailures={messages.apiFailures}
      errors={messages.errors}
      messages={messages.imageUpload}
      onChange={handleChange}
      sellerId={store}
    />
  )
}
