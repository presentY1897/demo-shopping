/**
 * `ImageDropZone` and `ImageUploadList` — picking product images and watching
 * them go up (TASK-0033).
 *
 * Two rules are on display here.
 *
 * **The file input is the control.** Tab reaches it, Enter and Space open the
 * picker, and voice control can address it by name. The dashed panel is its
 * label. Dropping is an addition on top of that, never the only way in — HTML5
 * drag and drop cannot be driven from a keyboard.
 *
 * **Order is the model.** The first row is the primary image because the API
 * stores a gallery by array index (`sortOrder`); there is no primary flag. So
 * "make primary" moves a row to the front, and every reorder control is a
 * button rather than a drag handle, which is what makes the gallery operable
 * without a pointer.
 */

import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import type { ImageUploadItem, ImageUploadListLabels } from '../../src/components'
import { ImageDropZone, ImageUploadList } from '../../src/components'
import { Stack } from '../support/layout'

const LABELS: ImageUploadListLabels = {
  listLabel: 'Product images',
  primaryBadge: 'Primary',
  progressLabel: 'Upload progress',
  statusLabels: {
    queued: 'Waiting',
    preparing: 'Resizing',
    requesting: 'Requesting an upload URL',
    uploading: 'Uploading',
    uploaded: 'Done',
    failed: 'Failed',
  },
  moveUp: 'Move earlier',
  moveDown: 'Move later',
  makePrimary: 'Make primary',
  retry: 'Try again',
  cancel: 'Cancel',
  remove: 'Remove',
}

const ITEMS: readonly ImageUploadItem[] = [
  { id: 'a', name: 'coat-front.jpg', status: 'uploaded' },
  { id: 'b', name: 'coat-back.jpg', progress: 62, status: 'uploading' },
  { id: 'c', name: 'coat-detail.png', status: 'queued' },
  {
    id: 'd',
    name: 'lookbook-original.jpg',
    status: 'failed',
    error: 'The file is larger than 5MB even after resizing. Please choose another one.',
  },
]

/**
 * The whole widget as a screen assembles it: one control to add files, one list
 * to say what happened to them.
 */
function ImageUploadPanel({ items }: { readonly items: readonly ImageUploadItem[] }) {
  const [rows, setRows] = useState<readonly ImageUploadItem[]>(items)

  const move = (id: string, direction: -1 | 1): void => {
    const from = rows.findIndex((row) => row.id === id)
    const to = from + direction

    if (from < 0 || to < 0 || to >= rows.length) return

    const next = [...rows]
    const [moved] = next.splice(from, 1)

    if (moved !== undefined) next.splice(to, 0, moved)
    setRows(next)
  }

  return (
    <Stack>
      <ImageDropZone
        accept="image/jpeg,image/png,image/webp"
        description="JPG, PNG or WebP · up to 5MB each · 10 images at most"
        dropLabel="Drop them here"
        label="Drag images here, or choose files"
        multiple
        onFiles={() => undefined}
      />

      <ImageUploadList
        items={rows}
        labels={LABELS}
        onCancel={(id) => {
          setRows(rows.filter((row) => row.id !== id))
        }}
        onMakePrimary={(id) => {
          setRows([...rows].sort((left, right) => Number(right.id === id) - Number(left.id === id)))
        }}
        onMove={move}
        onRemove={(id) => {
          setRows(rows.filter((row) => row.id !== id))
        }}
        onRetry={() => undefined}
      />
    </Stack>
  )
}

const meta = {
  title: 'Components/ImageUpload',
  component: ImageUploadPanel,
  tags: ['autodocs'],
  args: { items: ITEMS },
} satisfies Meta<typeof ImageUploadPanel>

export default meta

type Story = StoryObj<typeof meta>

/** Every status at once: done, uploading, waiting, failed. */
export const Gallery: Story = {}

/** Nothing chosen yet — the drop zone stands alone and the list renders nothing. */
export const Empty: Story = { args: { items: [] } }

/** One image is one image: no reorder is possible, and it is already primary. */
export const SingleImage: Story = {
  args: { items: [{ id: 'a', name: 'coat-front.jpg', status: 'uploaded' }] },
}

/**
 * A failure keeps its row. The other images stay uploaded and can still be
 * saved — a failure is an item's, never the batch's.
 */
export const Failed: Story = {
  args: {
    items: [
      { id: 'a', name: 'coat-front.jpg', status: 'uploaded' },
      {
        id: 'b',
        name: 'coat-back.jpg',
        status: 'failed',
        error: 'The upload did not go through. Check the connection and try again.',
      },
    ],
  },
}
