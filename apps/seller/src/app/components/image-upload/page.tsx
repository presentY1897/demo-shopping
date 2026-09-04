import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { messagesFor } from '@/messages'

import { ImageUploadPreview } from './image-upload-preview'

/**
 * `/components/image-upload` — the image widget, operable (TASK-0033 4.11).
 *
 * **A development tool, like the gallery it sits under.** `/products/new` is
 * TASK-0114's file and the widget has nowhere else to live until that screen
 * exists, so it gets a route of its own under `/components` — where "this is not
 * a seller-facing page" is already true of every sibling. Same guard as
 * `/components` and `/tokens`: the route compiles, typechecks and builds
 * everywhere and only the *response* differs, because a page excluded from the
 * build is a page that rots without anybody noticing.
 *
 * The store id is a query parameter so that a real presign can be tried against
 * a real store without editing a file. It defaults to a UUID that exists in no
 * database — which is the honest default while authentication is still
 * `AnonymousPrincipalResolver` and every presign answers 401 (4.10).
 */
export const dynamic = 'force-dynamic'

const ENABLED = process.env.NODE_ENV !== 'production'

/** A well formed UUID that owns nothing. The API answers 401 long before 404. */
const PLACEHOLDER_SELLER_ID = '0192f0c1-1111-7000-8000-000000000001'

const { imageUpload, errors, apiFailures } = messagesFor()

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: imageUpload.preview.title,
}

export default async function ImageUploadPreviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!ENABLED) notFound()

  const given = (await searchParams).sellerId
  const sellerId = typeof given === 'string' && given !== '' ? given : PLACEHOLDER_SELLER_ID

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-fg text-xl font-semibold">{imageUpload.preview.title}</h1>
        <p className="text-fg-muted text-sm">{imageUpload.preview.devOnlyNotice}</p>
        <p className="text-fg-subtle font-mono text-xs">
          {imageUpload.preview.storeLabel}: {sellerId}
        </p>
      </header>

      <ImageUploadPreview
        apiFailures={apiFailures}
        errors={errors}
        messages={imageUpload}
        sellerId={sellerId}
      />
    </div>
  )
}
