'use client'

/**
 * Choosing image files — by dropping them, or by the file picker (TASK-0033).
 *
 * **The file input is the control; the panel is a label for it.** A `<div>` with
 * an `onClick` that calls `input.click()` is the usual shape and it is not
 * reachable by keyboard, not announced as a file field, and not operable by
 * voice control. Here the real `<input type="file">` is in the tab order —
 * visually hidden, never `display: none`, which would take it out — and the
 * dashed panel is its `<label>`. Enter, Space, click and a dropped file all end
 * up in the same place.
 *
 * Dropping is an *addition* to that, not the mechanism: HTML5 drag and drop
 * cannot be driven from a keyboard, so anything only reachable by dragging is
 * unreachable for some people (QUALITY-GATES P4).
 *
 * No Korean lives here. Every string is a prop from the app's catalog
 * (CLAUDE.md 6장).
 */

import type { ChangeEvent, DragEvent, ReactNode } from 'react'
import { useCallback, useId, useRef, useState } from 'react'

import { cx } from '../lib/cx'

export interface ImageDropZoneProps {
  /** 이미지를 끌어다 놓거나 파일을 선택하세요 — from the app's catalog. */
  readonly label: ReactNode
  /** What is allowed: formats, size cap, how many are left. */
  readonly description?: ReactNode
  /** Replaces {@link ImageDropZoneProps.label} while a file is over the panel. */
  readonly dropLabel?: ReactNode
  /** `accept` of the input, e.g. `image/jpeg,image/png,image/webp`. */
  readonly accept: string
  readonly multiple?: boolean
  /** No more may be added — the gallery is full, or a save is in flight. */
  readonly disabled?: boolean
  /** Called with everything the person chose, dropped or picked. */
  readonly onFiles: (files: readonly File[]) => void
  readonly className?: string
}

export function ImageDropZone({
  label,
  description,
  dropLabel,
  accept,
  multiple = false,
  disabled = false,
  onFiles,
  className,
}: ImageDropZoneProps) {
  const inputId = useId()
  const descriptionId = useId()
  const [over, setOver] = useState(false)

  /**
   * Depth of the drag, not a boolean.
   *
   * `dragenter` and `dragleave` fire for every descendant the pointer crosses,
   * so a flag set on enter and cleared on leave goes off the moment the pointer
   * moves from the panel onto the text inside it — the highlight flickers and,
   * worse, ends up stuck on after the drop.
   */
  const depth = useRef(0)

  const takeFiles = useCallback(
    (list: FileList | null): void => {
      const files = list === null ? [] : [...list]

      if (files.length > 0) onFiles(files)
    },
    [onFiles],
  )

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      event.preventDefault()
      depth.current = 0
      setOver(false)
      if (!disabled) takeFiles(event.dataTransfer.files)
    },
    [disabled, takeFiles],
  )

  const onDragEnter = useCallback((event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    depth.current += 1
    setOver(true)
  }, [])

  const onDragLeave = useCallback((event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    depth.current -= 1
    if (depth.current <= 0) {
      depth.current = 0
      setOver(false)
    }
  }, [])

  return (
    <div
      className={cx('flex flex-col', className)}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      // Without this the browser navigates to the dropped file and the page is gone.
      onDragOver={(event) => {
        event.preventDefault()
      }}
      onDrop={onDrop}
    >
      <input
        accept={accept}
        aria-describedby={description === undefined ? undefined : descriptionId}
        className="peer sr-only"
        disabled={disabled}
        id={inputId}
        multiple={multiple}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          takeFiles(event.target.files)
          // Choosing the same file twice in a row fires no `change` otherwise,
          // which is exactly what somebody does after a failed upload.
          event.target.value = ''
        }}
        type="file"
      />

      <label
        className={cx(
          'border-border text-fg flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center transition-colors',
          'peer-focus-visible:outline-ring peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
          'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
          over ? 'border-primary bg-primary-surface' : 'hover:bg-surface-muted',
        )}
        htmlFor={inputId}
      >
        <span className="text-sm font-medium">
          {over && dropLabel !== undefined ? dropLabel : label}
        </span>
      </label>

      {description === undefined ? null : (
        <p className="text-fg-subtle mt-2 text-xs" id={descriptionId}>
          {description}
        </p>
      )}
    </div>
  )
}
