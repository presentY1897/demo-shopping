'use client'

import type { ApiClient, UploadContentType } from '@shopping/shared'
import type { ImageUploadItem } from '@shopping/ui/components'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFailure } from '@shopping/shared'

import type { RowFailure, UploadFailureKey, UploadMessages } from './failures'
import { localFailure, presignFailure, storageFailureKey } from './failures'
import type { GalleryEntry, Rejection, UploadFailureText } from './gallery'
import {
  admitFiles,
  failedIds,
  galleryImages,
  isBusy,
  MAX_GALLERY_IMAGES,
  moveEntry,
  patchEntry,
  promoteEntry,
  readyToStart,
  removeEntry,
  UPLOAD_CONCURRENCY,
} from './gallery'
import { exceedsSizeCap, isUploadableType } from './image-plan'
import { browserImageEncoder } from './browser-image-encoder'
import type { ImageEncoder } from './prepare-image'
import { prepareImage } from './prepare-image'
import type { UploadTransport } from './storage-transport'
import { xhrUploadTransport } from './xhr-transport'

/**
 * The widget's engine: a queue, three ports and a small state machine
 * (TASK-0033 4.3).
 *
 * **Everything that can be decided without a browser has already been decided
 * elsewhere.** Order, admission and which rows may start are `gallery.ts`; what
 * size to encode at is `image-plan.ts`; which sentence a failure gets is
 * `failures.ts`. What is left here is the sequencing — and sequencing is the one
 * thing a pure function cannot express.
 *
 * **Three ports, injectable.** The API client, the image encoder and the upload
 * transport. A spec runs against the msw double for the first, a fake encoder
 * for the second (jsdom has no canvas), and either the real XHR transport or a
 * fake one depending on whether it is asserting on progress.
 */

/** A failure the widget raised itself, carrying the key its sentence lives under. */
class LocalUploadError extends Error {
  override readonly name = 'LocalUploadError'

  constructor(readonly key: UploadFailureKey) {
    super(key)
  }
}

/** Where an attempt was when it failed, which decides how to read the error. */
type Phase = 'preparing' | 'requesting' | 'uploading'

export interface UseImageUploadOptions {
  /** The store the objects belong to. Checked against the caller's scope. */
  readonly sellerId: string
  /**
   * How to reach the API, resolved per attempt rather than per render.
   *
   * `getApiClient()` throws when `NEXT_PUBLIC_API_URL` is missing, and a
   * component that called it during render would take the whole route down over
   * a configuration mistake. Called inside the attempt, the same mistake becomes
   * one more failure the row can describe (`configuration`).
   */
  readonly client: () => ApiClient
  readonly messages: UploadMessages
  readonly maxImages?: number
  readonly concurrency?: number
  readonly encoder?: ImageEncoder
  readonly transport?: UploadTransport
}

export interface ImageUploadController {
  readonly items: readonly ImageUploadItem[]
  /** What a product write request carries, in gallery order. */
  readonly images: readonly { url: string }[]
  /** Something is still on its way; a save should wait. */
  readonly busy: boolean
  readonly full: boolean
  readonly hasFailures: boolean
  /**
   * The first failure a person should be given a number for, or `null`.
   *
   * Only a 5xx carries one (`quotableRequestId`), so this is empty for every
   * failure the reader can act on — a UUID beside "다른 파일을 선택해 주세요"
   * says nothing and suggests the problem is ours (TASK-0117 4.4).
   */
  readonly notice: UploadFailureText | null
  /** Files that never became rows, with the reason. Cleared on the next add. */
  readonly rejected: readonly Rejection[]
  add: (files: readonly File[]) => void
  move: (id: string, direction: -1 | 1) => void
  makePrimary: (id: string) => void
  cancel: (id: string) => void
  remove: (id: string) => void
  retry: (id: string) => void
  retryFailed: () => void
}

/**
 * A thumbnail source, or an empty string where object URLs are unavailable.
 *
 * jsdom implements `createObjectURL` only when it was built with blob support,
 * and a widget that threw during a spec's first render would be untestable for
 * a reason that has nothing to do with what it does.
 */
function previewUrlFor(file: File): string {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : ''
}

function releasePreview(url: string): void {
  if (url !== '' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
}

let sequence = 0

function nextEntryId(): string {
  sequence += 1

  return `upload-${String(sequence)}`
}

export function useImageUpload({
  sellerId,
  client,
  messages,
  maxImages = MAX_GALLERY_IMAGES,
  concurrency = UPLOAD_CONCURRENCY,
  encoder,
  transport,
}: UseImageUploadOptions): ImageUploadController {
  const [entries, setEntries] = useState<readonly GalleryEntry[]>([])
  const [rejected, setRejected] = useState<readonly Rejection[]>([])

  /**
   * The current entries, readable from an async attempt.
   *
   * An upload runs across several awaits and the state it started from is stale
   * by the second one; a ref is how the attempt asks "is this row still here"
   * without capturing a snapshot.
   */
  const entriesRef = useRef<readonly GalleryEntry[]>(entries)

  // Declared **before** the effect that starts uploads, because effects run in
  // declaration order within one commit: the queue runner has to see the
  // entries of the render it is reacting to, not the previous ones.
  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  /** One controller per running attempt, so cancel reaches the right request. */
  const controllers = useRef(new Map<string, AbortController>())
  /** Rows an attempt has already been started for, so an extra render cannot double it. */
  const started = useRef(new Set<string>())

  const imageEncoder = useMemo(() => encoder ?? browserImageEncoder(), [encoder])
  const uploads = useMemo(() => transport ?? xhrUploadTransport(), [transport])

  const patch = useCallback((id: string, changes: Partial<GalleryEntry>): void => {
    setEntries((current) => patchEntry(current, id, changes))
  }, [])

  const fail = useCallback(
    (id: string, failure: RowFailure): void => {
      patch(id, {
        failure: { message: failure.message, requestId: failure.requestId },
        status: 'failed',
      })
    },
    [patch],
  )

  /**
   * One attempt, from the file to a public URL.
   *
   * `phase` is what turns an exception into the right sentence: the same
   * `TypeError` means "this is not really a PNG" while decoding and "the
   * preflight was refused" while uploading, and only the caller knows which.
   */
  const runUpload = useCallback(
    async (id: string): Promise<void> => {
      const entry = entriesRef.current.find((candidate) => candidate.id === id)

      if (entry === undefined) return

      const controller = new AbortController()
      controllers.current.set(id, controller)

      let phase: Phase = 'preparing'

      patch(id, { failure: undefined, progress: undefined, status: 'preparing' })

      try {
        const contentType: string = entry.file.type

        if (!isUploadableType(contentType)) throw new LocalUploadError('unsupportedType')

        const prepared = await prepareImage(entry.file, contentType, imageEncoder)

        if (exceedsSizeCap(prepared.size)) throw new LocalUploadError('tooLarge')

        phase = 'requesting'
        patch(id, { status: 'requesting' })

        const { upload } = await client().presignUpload(
          {
            contentType: prepared.contentType satisfies UploadContentType,
            filename: prepared.filename,
            purpose: 'product-image',
            sellerId,
            size: prepared.size,
          },
          { signal: controller.signal },
        )

        phase = 'uploading'
        patch(id, { progress: 0, status: 'uploading' })

        await uploads.put(
          { body: prepared.body, headers: upload.headers, url: upload.uploadUrl },
          {
            onProgress: (percent) => {
              patch(id, { progress: percent })
            },
            signal: controller.signal,
          },
        )

        patch(id, { progress: 100, status: 'uploaded', url: upload.publicUrl })
      } catch (error) {
        // A cancelled row is already gone from the gallery; writing a failure on
        // to it would resurrect a message for something nobody is waiting for.
        if (controller.signal.aborted) return

        if (error instanceof LocalUploadError) {
          fail(id, localFailure(error.key, messages))
        } else if (phase === 'preparing') {
          fail(id, localFailure('decodeFailed', messages))
        } else if (phase === 'requesting') {
          fail(id, presignFailure(apiFailure(error), messages))
        } else {
          fail(id, localFailure(storageFailureKey(error), messages))
        }
      } finally {
        controllers.current.delete(id)
        started.current.delete(id)
      }
    },
    [client, fail, imageEncoder, messages, patch, sellerId, uploads],
  )

  /** Fills the free slots whenever the gallery changes. */
  useEffect(() => {
    for (const id of readyToStart(entries, concurrency)) {
      if (started.current.has(id)) continue

      started.current.add(id)
      void runUpload(id)
    }
  }, [concurrency, entries, runUpload])

  /** Object URLs outlive the component unless they are released. */
  useEffect(
    () => () => {
      for (const entry of entriesRef.current) releasePreview(entry.previewUrl)
      for (const controller of controllers.current.values()) controller.abort()
    },
    [],
  )

  const add = useCallback(
    (files: readonly File[]): void => {
      const admission = admitFiles(files, entriesRef.current.length, maxImages)

      setRejected(admission.rejected)
      setEntries((current) => [
        ...current,
        ...admission.accepted.map((file): GalleryEntry => ({
          file,
          id: nextEntryId(),
          name: file.name,
          previewUrl: previewUrlFor(file),
          status: 'queued',
        })),
      ])
    },
    [maxImages],
  )

  const drop = useCallback((id: string): void => {
    const entry = entriesRef.current.find((candidate) => candidate.id === id)

    if (entry !== undefined) releasePreview(entry.previewUrl)
    started.current.delete(id)
    setEntries((current) => removeEntry(current, id))
  }, [])

  const cancel = useCallback(
    (id: string): void => {
      controllers.current.get(id)?.abort()
      drop(id)
    },
    [drop],
  )

  const retry = useCallback(
    (id: string): void => {
      patch(id, { failure: undefined, progress: undefined, status: 'queued' })
    },
    [patch],
  )

  const retryFailed = useCallback((): void => {
    setEntries((current) =>
      failedIds(current).reduce(
        (next, id) =>
          patchEntry(next, id, { failure: undefined, progress: undefined, status: 'queued' }),
        current,
      ),
    )
  }, [])

  const items = useMemo<readonly ImageUploadItem[]>(
    () =>
      entries.map((entry) => ({
        error: entry.failure?.message,
        id: entry.id,
        name: entry.name,
        previewUrl: entry.previewUrl === '' ? undefined : entry.previewUrl,
        progress: entry.progress,
        status: entry.status,
      })),
    [entries],
  )

  // Memoised because a screen usually feeds this to an effect. A fresh array on
  // every render would make that effect run on every render.
  const images = useMemo(() => galleryImages(entries), [entries])

  const notice = useMemo<UploadFailureText | null>(
    () =>
      entries.find((entry) => entry.failure?.requestId != null && entry.failure.requestId !== '')
        ?.failure ?? null,
    [entries],
  )

  return {
    add,
    busy: isBusy(entries),
    cancel,
    full: entries.length >= maxImages,
    hasFailures: failedIds(entries).length > 0,
    images,
    items,
    notice,
    makePrimary: useCallback((id: string) => {
      setEntries((current) => promoteEntry(current, id))
    }, []),
    move: useCallback((id: string, direction: -1 | 1) => {
      setEntries((current) => moveEntry(current, id, direction))
    }, []),
    rejected,
    remove: drop,
    retry,
    retryFailed,
  }
}
