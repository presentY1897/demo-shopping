/**
 * The gallery under the drop zone: what is uploading, what failed, and in which
 * order the images will appear (TASK-0033).
 *
 * **Order is the model.** There is no "primary" flag anywhere — the first item
 * is the primary image, because that is how the API stores a gallery: the index
 * of the request array becomes `sortOrder`, and every reader sorts by it
 * (TASK-0033 4.6). "Make primary" therefore moves an item to the front, and the
 * badge on the first row is a statement about position, not about a field.
 *
 * **Reordering is buttons, not dragging.** A drag handle cannot be operated from
 * a keyboard, and a gallery that can only be ordered with a pointer fails P4 for
 * everybody who does not use one. Files are still *dropped* — that is
 * `ImageDropZone`, and dropping is an addition to a control that already works.
 *
 * No `'use client'`: nothing here holds state or touches a browser API. The
 * screen that owns the queue is the client component.
 */

import type { ReactNode } from 'react'

import { Button } from '../components/button'
import { IconButton } from '../components/icon-button'
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, StarIcon } from '../components/icons'
import { cx } from '../lib/cx'

/** Where one item is in the pipeline. `queued` is waiting for a slot. */
export const IMAGE_UPLOAD_STATUSES = [
  'queued',
  'preparing',
  'requesting',
  'uploading',
  'uploaded',
  'failed',
] as const

export type ImageUploadStatus = (typeof IMAGE_UPLOAD_STATUSES)[number]

/** The statuses that are still going somewhere, so a row can say "busy". */
const IN_FLIGHT: ReadonlySet<ImageUploadStatus> = new Set<ImageUploadStatus>([
  'queued',
  'preparing',
  'requesting',
  'uploading',
])

export interface ImageUploadItem {
  readonly id: string
  /** The file's name on the caller's machine. Shown so a failure can be placed. */
  readonly name: string
  /**
   * A thumbnail source.
   *
   * An object URL for the file that was chosen, not the public URL of the
   * uploaded object: the public read domain and the bucket that was written to
   * are different deployments' business, and a preview that depends on the
   * upload having propagated shows a broken image for the first second.
   */
  readonly previewUrl?: string
  readonly status: ImageUploadStatus
  /** 0–100, while `status` is `uploading`. */
  readonly progress?: number
  /** Why this one failed, already in the reader's language. */
  readonly error?: ReactNode
}

export interface ImageUploadListLabels {
  /** Accessible name of the list itself — 등록한 이미지. */
  readonly listLabel: string
  /** Badge on the first row — 대표. */
  readonly primaryBadge: string
  /** Accessible name of a progress bar — 업로드 진행률. */
  readonly progressLabel: string
  readonly statusLabels: Readonly<Record<ImageUploadStatus, string>>
  readonly moveUp: string
  readonly moveDown: string
  readonly makePrimary: string
  readonly retry: string
  readonly cancel: string
  readonly remove: string
}

export interface ImageUploadListProps {
  readonly items: readonly ImageUploadItem[]
  readonly labels: ImageUploadListLabels
  readonly onMove: (id: string, direction: -1 | 1) => void
  readonly onMakePrimary: (id: string) => void
  /** Stops an upload that is still going. Absent rows get no cancel button. */
  readonly onCancel: (id: string) => void
  /** Takes the item out of the gallery. Does not delete the stored object (4.8). */
  readonly onRemove: (id: string) => void
  readonly onRetry: (id: string) => void
  readonly className?: string
}

/**
 * Every control on a row names the file it belongs to.
 *
 * Six rows of "앞으로" is a list a screen reader user cannot navigate: the names
 * are identical and the position is only visible. The separator is punctuation,
 * not copy, so it stays here rather than becoming a seventh label to translate.
 */
function named(label: string, name: string): string {
  return `${label}: ${name}`
}

export function ImageUploadList({
  items,
  labels,
  onMove,
  onMakePrimary,
  onCancel,
  onRemove,
  onRetry,
  className,
}: ImageUploadListProps) {
  if (items.length === 0) return null

  return (
    <ol aria-label={labels.listLabel} className={cx('flex flex-col gap-2', className)}>
      {items.map((item, index) => {
        const busy = IN_FLIGHT.has(item.status)
        const percent = item.progress ?? 0

        return (
          <li
            aria-busy={busy || undefined}
            className="border-border bg-surface flex items-center gap-3 rounded-md border p-2"
            key={item.id}
          >
            <span className="bg-surface-muted size-12 shrink-0 overflow-hidden rounded">
              {item.previewUrl === undefined ? null : (
                /*
                  Empty alt on purpose: the file name is right beside it, and a
                  thumbnail that repeats it is announced twice.
                */
                /* eslint-disable-next-line @next/next/no-img-element -- a `blob:`
                   object URL for a file still on this machine. `next/image`
                   cannot optimise one, and this package does not depend on Next. */
                <img alt="" className="size-full object-cover" src={item.previewUrl} />
              )}
            </span>

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <p className="text-fg truncate text-sm font-medium">{item.name}</p>
                {index === 0 ? (
                  <span className="bg-primary-surface text-fg shrink-0 rounded-full px-2 py-0.5 text-xs">
                    {labels.primaryBadge}
                  </span>
                ) : null}
              </div>

              <p
                className={cx(
                  'text-xs',
                  item.status === 'failed' ? 'text-danger' : 'text-fg-muted',
                )}
              >
                {labels.statusLabels[item.status]}
              </p>

              {item.status === 'uploading' ? (
                <div
                  aria-label={named(labels.progressLabel, item.name)}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={percent}
                  className="bg-surface-muted h-1.5 w-full overflow-hidden rounded-full"
                  role="progressbar"
                >
                  <div
                    className="bg-primary h-full rounded-full transition-all"
                    style={{ width: `${String(percent)}%` }}
                  />
                </div>
              ) : null}

              {item.error === undefined ? null : (
                <p className="text-danger text-xs">{item.error}</p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {item.status === 'failed' ? (
                <Button
                  onClick={() => {
                    onRetry(item.id)
                  }}
                  size="sm"
                  variant="outline"
                >
                  {labels.retry}
                </Button>
              ) : null}

              <IconButton
                disabled={index === 0}
                label={named(labels.moveUp, item.name)}
                onClick={() => {
                  onMove(item.id, -1)
                }}
                size="sm"
              >
                <ChevronUpIcon className="size-4" />
              </IconButton>

              <IconButton
                disabled={index === items.length - 1}
                label={named(labels.moveDown, item.name)}
                onClick={() => {
                  onMove(item.id, 1)
                }}
                size="sm"
              >
                <ChevronDownIcon className="size-4" />
              </IconButton>

              <IconButton
                disabled={index === 0}
                label={named(labels.makePrimary, item.name)}
                onClick={() => {
                  onMakePrimary(item.id)
                }}
                size="sm"
              >
                <StarIcon className="size-4" />
              </IconButton>

              <IconButton
                label={named(busy ? labels.cancel : labels.remove, item.name)}
                onClick={() => {
                  if (busy) onCancel(item.id)
                  else onRemove(item.id)
                }}
                size="sm"
                variant="ghost"
              >
                <CloseIcon className="size-4" />
              </IconButton>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
