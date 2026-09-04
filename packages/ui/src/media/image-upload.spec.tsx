/**
 * What a person does with the two media components: choose files, and reorder
 * what came back.
 *
 * The drop zone's whole claim is that it works without a pointer, so the picker
 * is driven from the keyboard here; the list's whole claim is that order is the
 * model, so the assertions are about which row is first.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { setupUser } from '../../test/support/ui'
import { ImageDropZone } from './image-drop-zone'
import type { ImageUploadItem, ImageUploadListLabels } from './image-upload-list'
import { ImageUploadList } from './image-upload-list'

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

const NOOP = {
  onCancel: () => undefined,
  onMakePrimary: () => undefined,
  onMove: () => undefined,
  onRemove: () => undefined,
  onRetry: () => undefined,
}

function imageFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
}

describe('ImageDropZone', () => {
  it('is a file input a keyboard can reach and name', async () => {
    const user = setupUser()
    render(<ImageDropZone accept="image/png" label="Drag images here" onFiles={() => undefined} />)

    await user.tab()

    expect(screen.getByLabelText('Drag images here')).toHaveFocus()
  })

  it('reports the files that were picked', async () => {
    const user = setupUser()
    const onFiles = vi.fn()
    render(<ImageDropZone accept="image/png" label="Drag images here" multiple onFiles={onFiles} />)

    await user.upload(screen.getByLabelText('Drag images here'), [
      imageFile('one.png'),
      imageFile('two.png'),
    ])

    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles.mock.calls[0]?.[0]).toHaveLength(2)
  })

  it('reports the files that were dropped', () => {
    const onFiles = vi.fn()
    const { container } = render(
      <ImageDropZone accept="image/png" label="Drag images here" onFiles={onFiles} />,
    )
    fireEvent.drop(container.firstElementChild!, {
      dataTransfer: { files: [imageFile('dropped.png')] },
    })

    expect(onFiles).toHaveBeenCalledTimes(1)
  })

  it('ignores a drop while it is disabled', () => {
    const onFiles = vi.fn()
    const { container } = render(
      <ImageDropZone accept="image/png" disabled label="Drag images here" onFiles={onFiles} />,
    )

    fireEvent.drop(container.firstElementChild!, {
      dataTransfer: { files: [imageFile('dropped.png')] },
    })

    expect(onFiles).not.toHaveBeenCalled()
  })

  it('says nothing about a drag that carried no file', () => {
    const onFiles = vi.fn()
    const { container } = render(
      <ImageDropZone accept="image/png" label="Drag images here" onFiles={onFiles} />,
    )

    fireEvent.drop(container.firstElementChild!, { dataTransfer: { files: [] } })

    expect(onFiles).not.toHaveBeenCalled()
  })
})

describe('ImageUploadList', () => {
  const items: readonly ImageUploadItem[] = [
    { id: 'a', name: 'front.jpg', status: 'uploaded' },
    { id: 'b', name: 'back.jpg', progress: 40, status: 'uploading' },
    { id: 'c', name: 'detail.jpg', error: 'Too large', status: 'failed' },
  ]

  it('renders nothing when the gallery is empty', () => {
    const { container } = render(<ImageUploadList items={[]} labels={LABELS} {...NOOP} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('marks the first row as the primary image', () => {
    render(<ImageUploadList items={items} labels={LABELS} {...NOOP} />)

    const rows = screen.getAllByRole('listitem')

    expect(within(rows[0]!).getByText('Primary')).toBeVisible()
    expect(within(rows[1]!).queryByText('Primary')).toBeNull()
  })

  it('cannot move the first row earlier or the last row later', () => {
    render(<ImageUploadList items={items} labels={LABELS} {...NOOP} />)

    expect(screen.getByRole('button', { name: 'Move earlier: front.jpg' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move later: detail.jpg' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move later: front.jpg' })).toBeEnabled()
  })

  it('moves a row from the keyboard', async () => {
    const user = setupUser()
    const onMove = vi.fn()
    render(<ImageUploadList items={items} labels={LABELS} {...NOOP} onMove={onMove} />)

    const button = screen.getByRole('button', { name: 'Move earlier: back.jpg' })
    button.focus()
    await user.keyboard('{Enter}')

    expect(onMove).toHaveBeenCalledWith('b', -1)
  })

  it('promotes a row to primary', async () => {
    const user = setupUser()
    const onMakePrimary = vi.fn()
    render(
      <ImageUploadList items={items} labels={LABELS} {...NOOP} onMakePrimary={onMakePrimary} />,
    )

    await user.click(screen.getByRole('button', { name: 'Make primary: detail.jpg' }))

    expect(onMakePrimary).toHaveBeenCalledWith('c')
  })

  it('reports upload progress as a progressbar, not as a picture of one', () => {
    render(<ImageUploadList items={items} labels={LABELS} {...NOOP} />)

    const bar = screen.getByRole('progressbar', { name: 'Upload progress: back.jpg' })

    expect(bar).toHaveAttribute('aria-valuenow', '40')
    expect(screen.queryByRole('progressbar', { name: 'Upload progress: front.jpg' })).toBeNull()
  })

  it('offers a retry only on the row that failed, and shows why', async () => {
    const user = setupUser()
    const onRetry = vi.fn()
    render(<ImageUploadList items={items} labels={LABELS} {...NOOP} onRetry={onRetry} />)

    expect(screen.getByText('Too large')).toBeVisible()

    const buttons = screen.getAllByRole('button', { name: 'Try again' })
    expect(buttons).toHaveLength(1)

    await user.click(buttons[0]!)
    expect(onRetry).toHaveBeenCalledWith('c')
  })

  it('cancels a row that is still going and removes one that is not', async () => {
    const user = setupUser()
    const onCancel = vi.fn()
    const onRemove = vi.fn()
    render(
      <ImageUploadList
        items={items}
        labels={LABELS}
        {...NOOP}
        onCancel={onCancel}
        onRemove={onRemove}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Cancel: back.jpg' }))
    await user.click(screen.getByRole('button', { name: 'Remove: front.jpg' }))

    expect(onCancel).toHaveBeenCalledWith('b')
    expect(onRemove).toHaveBeenCalledWith('a')
  })
})
