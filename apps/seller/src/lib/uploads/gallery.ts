import type { ImageUploadStatus } from '@shopping/ui/components'

import { isUploadableType } from './image-plan'

/**
 * The gallery, as a value (TASK-0033 4.3, 4.6).
 *
 * Every function is `(entries, …) => entries`, with no clock, no network and no
 * React. Order is the model — the first entry is the primary image, because the
 * API stores a gallery by array index — so "make primary" is a move, and a
 * screen never has to keep a flag and an order in step.
 */

/** How many uploads run at once. See {@link readyToStart}. */
export const UPLOAD_CONCURRENCY = 3

/** The gallery cap the product write contract enforces (`PRODUCT_MAX_IMAGES`). */
export { PRODUCT_MAX_IMAGES as MAX_GALLERY_IMAGES } from '@shopping/shared'

export interface UploadFailureText {
  /** Already in the reader's language — the catalog resolved it. */
  readonly message: string
  /** Shown only for a failure nobody on this screen can fix (5xx). */
  readonly requestId: string | null
}

export interface GalleryEntry {
  readonly id: string
  /** The name shown to the reader: the file's own, not the storage key. */
  readonly name: string
  readonly file: File
  /** `blob:` URL for the thumbnail. Revoked when the entry goes away. */
  readonly previewUrl: string
  readonly status: ImageUploadStatus
  readonly progress?: number
  readonly failure?: UploadFailureText
  /** Where the object will be readable. Present once `status` is `uploaded`. */
  readonly url?: string
}

/** The statuses that already hold a slot. */
const RUNNING: ReadonlySet<ImageUploadStatus> = new Set<ImageUploadStatus>([
  'preparing',
  'requesting',
  'uploading',
])

export function indexOf(entries: readonly GalleryEntry[], id: string): number {
  return entries.findIndex((entry) => entry.id === id)
}

/**
 * The array with one entry taken out and put back at `to`.
 *
 * Built with `slice` rather than two `splice` calls so there is no "the element
 * I just removed might be undefined" guard. That guard is unreachable — the
 * caller has already checked the index — and an unreachable branch is exactly
 * what turns a 100% branch target into a waiver.
 */
function reinsert(
  entries: readonly GalleryEntry[],
  from: number,
  to: number,
): readonly GalleryEntry[] {
  const moved = entries[from]!
  const rest = entries.filter((_unused, index) => index !== from)

  return [...rest.slice(0, to), moved, ...rest.slice(to)]
}

/**
 * Moves one entry by one place. Out of range is a no-op rather than an error:
 * the buttons at the ends are disabled, and a keyboard repeat that outruns a
 * re-render should do nothing rather than throw.
 */
export function moveEntry(
  entries: readonly GalleryEntry[],
  id: string,
  direction: -1 | 1,
): readonly GalleryEntry[] {
  const from = indexOf(entries, id)
  const to = from + direction

  if (from < 0 || to < 0 || to >= entries.length) return entries

  return reinsert(entries, from, to)
}

/** Makes an entry the primary image by putting it first. */
export function promoteEntry(
  entries: readonly GalleryEntry[],
  id: string,
): readonly GalleryEntry[] {
  const from = indexOf(entries, id)

  if (from <= 0) return entries

  return reinsert(entries, from, 0)
}

export function removeEntry(entries: readonly GalleryEntry[], id: string): readonly GalleryEntry[] {
  return entries.filter((entry) => entry.id !== id)
}

/**
 * Replaces the fields of one entry.
 *
 * `failure` and `progress` are cleared by passing them explicitly, because a
 * retry has to drop the message from the previous attempt — a row that said
 * "다시 시도" while showing the old error would be lying about which attempt it
 * is describing.
 */
export function patchEntry(
  entries: readonly GalleryEntry[],
  id: string,
  patch: Partial<GalleryEntry>,
): readonly GalleryEntry[] {
  return entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
}

/**
 * The ids that should start now.
 *
 * Three at a time, not all of them. A browser allows six connections per origin,
 * and five uploads plus their presign calls saturate that — the presign requests
 * queue *behind* the uploads and the first image finishes later than it would
 * have alone. Three also keeps the progress bars readable: five bars creeping
 * together tell nobody which one is nearly done.
 */
export function readyToStart(
  entries: readonly GalleryEntry[],
  concurrency: number = UPLOAD_CONCURRENCY,
): readonly string[] {
  const running = entries.filter((entry) => RUNNING.has(entry.status)).length
  const slots = Math.max(0, concurrency - running)

  return entries
    .filter((entry) => entry.status === 'queued')
    .slice(0, slots)
    .map((entry) => entry.id)
}

/** True while anything is still on its way, which is what disables a save. */
export function isBusy(entries: readonly GalleryEntry[]): boolean {
  return entries.some((entry) => entry.status === 'queued' || RUNNING.has(entry.status))
}

export function failedIds(entries: readonly GalleryEntry[]): readonly string[] {
  return entries.filter((entry) => entry.status === 'failed').map((entry) => entry.id)
}

/**
 * What the product write request carries, in gallery order.
 *
 * Only uploaded entries: a row that is still going has no URL, and one that
 * failed must not silently disappear into a saved product as a gap.
 */
export function galleryImages(entries: readonly GalleryEntry[]): readonly { url: string }[] {
  return entries.flatMap((entry) =>
    entry.status === 'uploaded' && entry.url !== undefined ? [{ url: entry.url }] : [],
  )
}

/** Why a chosen file never became an entry. */
export type RejectionReason = 'unsupportedType' | 'tooManyImages'

export interface Rejection {
  readonly name: string
  readonly reason: RejectionReason
}

export interface Admission {
  readonly accepted: readonly File[]
  readonly rejected: readonly Rejection[]
}

/**
 * Splits a drop into what can be added and what cannot, with the reason.
 *
 * Both checks happen before anything is decoded or uploaded. A person who drags
 * a folder of twelve photos at a gallery that holds ten should be told which two
 * did not make it — not watch ten succeed and two fail with a server error.
 */
export function admitFiles(files: readonly File[], taken: number, capacity: number): Admission {
  const accepted: File[] = []
  const rejected: Rejection[] = []

  for (const file of files) {
    if (!isUploadableType(file.type)) {
      rejected.push({ name: file.name, reason: 'unsupportedType' })
      continue
    }
    if (taken + accepted.length >= capacity) {
      rejected.push({ name: file.name, reason: 'tooManyImages' })
      continue
    }

    accepted.push(file)
  }

  return { accepted, rejected }
}
