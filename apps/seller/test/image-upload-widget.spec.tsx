/**
 * The image widget, driven the way a seller drives it (TASK-0033).
 *
 * Every call in here goes to `@shopping/api-mocks` — both halves of it, because
 * this widget talks to two systems: our presign endpoint and the bucket. The
 * setup asserts that nothing left the process (`setupTestServer` counts sockets),
 * so "실 API 호출 0건" is measured rather than intended.
 *
 * The image **encoder** is a stub. jsdom has no canvas and no
 * `createImageBitmap`, so the pixels cannot be exercised here at all — which is
 * exactly why the resize *decisions* are pure functions with their own spec, and
 * why the real encode is verified in a browser instead (6.4).
 */

import { httpFailureOn, MOCK_REQUEST_ID, mockPaths, networkFailureOn } from '@shopping/api-mocks'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ProductImageUploader } from '@/components/product-images/product-image-uploader'
import type { ImageEncoder } from '@/lib/uploads/prepare-image'
import type { UploadTransport } from '@/lib/uploads/storage-transport'
import { StorageUploadError } from '@/lib/uploads/storage-transport'
import { ko } from '@/messages/ko'

import { testServer } from './setup'
import { controlledTransport, fetchUploadTransport } from './support/uploads'

const SELLER_ID = '0192f0c1-1111-7000-8000-000000000001'

const { imageUpload } = ko

/** Big enough that `fitWithin` has something to do; the bytes are irrelevant. */
function stubEncoder(natural = { height: 3000, width: 4000 }): ImageEncoder {
  return {
    encode: (_file, target) =>
      Promise.resolve(new Blob([new Uint8Array(target.width)], { type: 'image/png' })),
    measure: () => Promise.resolve(natural),
  }
}

/** An encoder that leaves the file alone, so the original bytes are uploaded. */
const passthroughEncoder = stubEncoder({ height: 600, width: 800 })

function imageFile(name: string, bytes = 64): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' })
}

function renderWidget(
  overrides: {
    readonly encoder?: ImageEncoder
    readonly transport?: UploadTransport
    readonly onChange?: (images: readonly { url: string }[]) => void
  } = {},
) {
  return render(
    <ProductImageUploader
      apiFailures={ko.apiFailures}
      encoder={overrides.encoder ?? passthroughEncoder}
      errors={ko.errors}
      messages={imageUpload}
      onChange={overrides.onChange}
      sellerId={SELLER_ID}
      transport={overrides.transport ?? fetchUploadTransport()}
    />,
  )
}

function picker(): HTMLElement {
  return screen.getByLabelText(imageUpload.pickLabel)
}

async function uploadFiles(user: ReturnType<typeof userEvent.setup>, files: readonly File[]) {
  await user.upload(picker(), [...files])
}

/** The gallery's own rows. The rejection notice is a list too. */
function galleryRows(): readonly HTMLElement[] {
  const gallery = screen.queryByRole('list', { name: imageUpload.list.listLabel })

  return gallery === null ? [] : within(gallery).getAllByRole('listitem')
}

function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest('li')

  if (row === null) throw new Error(`no gallery row for ${name}`)

  return row
}

async function waitForDone(name: string): Promise<void> {
  await waitFor(
    () => {
      expect(within(rowFor(name)).getByText(imageUpload.list.statusLabels.uploaded)).toBeVisible()
    },
    { timeout: 4_000 },
  )
}

describe('before anything is chosen', () => {
  it('says the gallery is empty and offers the picker', () => {
    renderWidget()

    expect(screen.getByText(imageUpload.emptyDescription)).toBeVisible()
    expect(picker()).toBeEnabled()
  })
})

describe('uploading', () => {
  it('takes five images at once and finishes all of them', async () => {
    const user = userEvent.setup()
    renderWidget()

    const names = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png']
    await uploadFiles(
      user,
      names.map((name) => imageFile(name)),
    )

    for (const name of names) await waitForDone(name)

    expect(galleryRows()).toHaveLength(5)
  })

  it('declares the resized byte length, not the original', async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []

    testServer.server.events.on('request:start', ({ request }) => {
      if (request.url.includes('/uploads/presign')) {
        void request
          .clone()
          .json()
          .then((body: unknown) => bodies.push(body))
      }
    })

    renderWidget({ encoder: stubEncoder() })
    await uploadFiles(user, [imageFile('coat.png', 9_000)])
    await waitForDone('coat.png')

    // The stub encodes `target.width` bytes, and 4000x3000 fits to 2000x1500.
    expect(bodies).toEqual([
      expect.objectContaining({ contentType: 'image/png', filename: 'coat.png', size: 2000 }),
    ])
  })

  it('hands the saved gallery to the form, one entry per finished upload', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWidget({ onChange })

    await uploadFiles(user, [imageFile('first.png'), imageFile('second.png')])
    await waitForDone('first.png')
    await waitForDone('second.png')

    await waitFor(() => {
      const images = onChange.mock.lastCall?.[0] as readonly { url: string }[]

      expect(images).toHaveLength(2)
      // The key is built by the server from a UUID, never from the file name
      // (TASK-0011 4.4), so two uploads are two different objects.
      expect(new Set(images.map((image) => image.url)).size).toBe(2)
    })
  })
})

describe('order', () => {
  it('reorders from the keyboard and the saved gallery follows', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWidget({ onChange })

    await uploadFiles(user, [imageFile('first.png'), imageFile('second.png')])
    await waitForDone('first.png')
    await waitForDone('second.png')

    const before = onChange.mock.lastCall?.[0] as readonly { url: string }[]

    const moveUp = screen.getByRole('button', {
      name: `${imageUpload.list.moveUp}: second.png`,
    })
    moveUp.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith([before[1], before[0]])
    })
  })

  it('makes a row primary by putting it first', async () => {
    const user = userEvent.setup()
    renderWidget()

    await uploadFiles(user, [imageFile('first.png'), imageFile('second.png')])
    await waitForDone('second.png')

    await user.click(
      screen.getByRole('button', { name: `${imageUpload.list.makePrimary}: second.png` }),
    )

    const rows = galleryRows()
    expect(within(rows[0]!).getByText('second.png')).toBeVisible()
    expect(within(rows[0]!).getByText(imageUpload.list.primaryBadge)).toBeVisible()
  })
})

describe('a refusal from our API', () => {
  it('says a signed-out seller has to sign in', async () => {
    const user = userEvent.setup()
    testServer.server.use(
      httpFailureOn('post', mockPaths.uploadPresign, 401, 'AUTH_REQUIRED', '로그인이 필요해요.'),
    )
    renderWidget()

    await uploadFiles(user, [imageFile('coat.png')])

    expect(await screen.findByText(ko.errors.AUTH_REQUIRED)).toBeVisible()
    expect(within(rowFor('coat.png')).getByText(imageUpload.list.statusLabels.failed)).toBeVisible()
  })

  it('places the sentence for the input the API blamed', async () => {
    const user = userEvent.setup()
    testServer.server.use(
      httpFailureOn(
        'post',
        mockPaths.uploadPresign,
        400,
        'BAD_REQUEST',
        '요청 형식이 올바르지 않습니다.',
        [{ code: 'UNSUPPORTED_MEDIA_TYPE', field: 'filename', message: '서버가 쓴 문장' }],
      ),
    )
    renderWidget()

    await uploadFiles(user, [imageFile('coat.png')])

    expect(await screen.findByText(ko.errors.UNSUPPORTED_MEDIA_TYPE)).toBeVisible()
    expect(screen.queryByText('서버가 쓴 문장')).toBeNull()
  })

  it('offers the request number for a failure nobody here can fix', async () => {
    const user = userEvent.setup()
    testServer.server.use(
      httpFailureOn(
        'post',
        mockPaths.uploadPresign,
        500,
        'INTERNAL_ERROR',
        '서버에 문제가 생겼습니다.',
      ),
    )
    renderWidget()

    await uploadFiles(user, [imageFile('coat.png')])

    expect(await screen.findByText(imageUpload.noticeTitle)).toBeVisible()
    expect(screen.getByText(MOCK_REQUEST_ID)).toBeVisible()
  })

  it('shows no request number for a refusal the seller can act on', async () => {
    const user = userEvent.setup()
    testServer.server.use(
      httpFailureOn(
        'post',
        mockPaths.uploadPresign,
        403,
        'FORBIDDEN',
        '이 작업을 수행할 권한이 없습니다.',
      ),
    )
    renderWidget()

    await uploadFiles(user, [imageFile('coat.png')])

    expect(await screen.findByText(ko.errors.FORBIDDEN)).toBeVisible()
    expect(screen.queryByText(MOCK_REQUEST_ID)).toBeNull()
  })
})

describe('a refusal from the bucket', () => {
  it('says the upload URL expired when the signature is refused', async () => {
    const user = userEvent.setup()
    const transport: UploadTransport = {
      put: () => Promise.reject(new StorageUploadError('rejected', 403)),
    }
    renderWidget({ transport })

    await uploadFiles(user, [imageFile('coat.png')])

    expect(await screen.findByText(imageUpload.failures.rejected)).toBeVisible()
  })

  it('sends a preflight refusal and an offline browser to the same sentence', async () => {
    const user = userEvent.setup()
    const transport: UploadTransport = { put: () => Promise.reject(new TypeError('network')) }
    renderWidget({ transport })

    await uploadFiles(user, [imageFile('coat.png')])

    expect(await screen.findByText(imageUpload.failures.blocked)).toBeVisible()
  })
})

describe('the file itself', () => {
  it('refuses a format the bucket does not take, naming the file', async () => {
    // Dropped rather than picked: the file input carries `accept`, so a browser
    // never offers a GIF there — but a drop can hand over anything, and that is
    // the path the check exists for.
    const { container } = renderWidget()

    fireEvent.drop(container.querySelector('label')?.parentElement as Element, {
      dataTransfer: { files: [new File([new Uint8Array(4)], 'note.gif', { type: 'image/gif' })] },
    })

    expect(await screen.findByText(imageUpload.rejectedTitle)).toBeVisible()
    expect(screen.getByText(imageUpload.rejections.unsupportedType)).toBeVisible()
    expect(galleryRows()).toHaveLength(0)
  })

  it('refuses an image that is still over the cap after resizing', async () => {
    const user = userEvent.setup()
    const huge: ImageEncoder = {
      encode: () => Promise.resolve(new Blob([new Uint8Array(6 * 1024 * 1024)])),
      measure: () => Promise.resolve({ height: 6000, width: 8000 }),
    }
    renderWidget({ encoder: huge })

    await uploadFiles(user, [imageFile('huge.png', 7 * 1024 * 1024)])

    expect(await screen.findByText(imageUpload.failures.tooLarge)).toBeVisible()
  })

  it('says an undecodable file could not be read', async () => {
    const user = userEvent.setup()
    const broken: ImageEncoder = {
      encode: () => Promise.reject(new Error('decode')),
      measure: () => Promise.reject(new Error('decode')),
    }
    renderWidget({ encoder: broken })

    await uploadFiles(user, [imageFile('broken.png')])

    expect(await screen.findByText(imageUpload.failures.decodeFailed)).toBeVisible()
  })

  it('stops taking files once the gallery is full', async () => {
    const user = userEvent.setup()
    renderWidget()

    await uploadFiles(
      user,
      Array.from({ length: 11 }, (_unused, index) => imageFile(`p${String(index)}.png`)),
    )

    expect(await screen.findByText(imageUpload.rejections.tooManyImages)).toBeVisible()
    expect(galleryRows()).toHaveLength(10)
  })
})

describe('retrying', () => {
  it('retries only the row that failed', async () => {
    const user = userEvent.setup()
    testServer.server.use(networkFailureOn('post', mockPaths.uploadPresign))
    renderWidget()

    await uploadFiles(user, [imageFile('coat.png')])
    expect(await screen.findByText(ko.apiFailures.network)).toBeVisible()

    // The connection comes back: the default handlers answer again.
    testServer.server.resetHandlers()

    await user.click(screen.getByRole('button', { name: imageUpload.list.retry }))

    await waitForDone('coat.png')
    expect(screen.queryByText(ko.apiFailures.network)).toBeNull()
  })

  it('retries every failed row from one button', async () => {
    const user = userEvent.setup()
    testServer.server.use(networkFailureOn('post', mockPaths.uploadPresign))
    renderWidget()

    await uploadFiles(user, [imageFile('a.png'), imageFile('b.png')])
    await waitFor(() => {
      expect(screen.getAllByText(ko.apiFailures.network)).toHaveLength(2)
    })

    testServer.server.resetHandlers()
    await user.click(screen.getByRole('button', { name: imageUpload.retryAllLabel }))

    await waitForDone('a.png')
    await waitForDone('b.png')
  })
})

describe('cancelling and removing', () => {
  it('takes a row that is still going out of the gallery', async () => {
    const user = userEvent.setup()
    // Never settles, so the row stays in flight for the whole test.
    const transport: UploadTransport = { put: () => new Promise(() => undefined) }
    renderWidget({ transport })

    await uploadFiles(user, [imageFile('coat.png')])
    await waitFor(() => {
      expect(
        within(rowFor('coat.png')).getByText(imageUpload.list.statusLabels.uploading),
      ).toBeVisible()
    })

    await user.click(screen.getByRole('button', { name: `${imageUpload.list.cancel}: coat.png` }))

    expect(screen.queryByText('coat.png')).toBeNull()
  })

  it('takes a finished row out and out of the saved gallery with it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWidget({ onChange })

    await uploadFiles(user, [imageFile('coat.png')])
    await waitForDone('coat.png')

    await user.click(screen.getByRole('button', { name: `${imageUpload.list.remove}: coat.png` }))

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith([])
    })
    expect(screen.getByText(imageUpload.emptyDescription)).toBeVisible()
  })
})

describe('while an upload is in flight', () => {
  it("reports the browser's progress as a progress bar", async () => {
    const user = userEvent.setup()
    const controlled = controlledTransport()
    renderWidget({ transport: controlled.transport })

    await uploadFiles(user, [imageFile('coat.png')])
    await waitFor(() => {
      expect(controlled.started()).toBe(1)
    })

    controlled.report(42)

    const bar = await screen.findByRole('progressbar', {
      name: `${imageUpload.list.progressLabel}: coat.png`,
    })
    expect(bar).toHaveAttribute('aria-valuenow', '42')
  })

  it('runs three at a time and leaves the rest waiting', async () => {
    const user = userEvent.setup()
    const controlled = controlledTransport()
    renderWidget({ transport: controlled.transport })

    await uploadFiles(
      user,
      Array.from({ length: 5 }, (_unused, index) => imageFile(`p${String(index)}.png`)),
    )

    await waitFor(() => {
      expect(controlled.started()).toBe(3)
    })

    expect(
      within(screen.getByRole('list', { name: imageUpload.list.listLabel })).getAllByText(
        imageUpload.list.statusLabels.queued,
      ),
    ).toHaveLength(2)

    // A finished slot is handed to the next row, not left idle.
    controlled.finish()
    await waitFor(() => {
      expect(controlled.started()).toBe(3)
    })
  })

  it('starts one attempt per row, however often the screen re-renders', async () => {
    const user = userEvent.setup()
    const controlled = controlledTransport()
    renderWidget({ transport: controlled.transport })

    await uploadFiles(user, [imageFile('coat.png')])
    await waitFor(() => {
      expect(controlled.started()).toBe(1)
    })

    // Reordering, hovering, any state change re-runs the queue effect.
    controlled.report(10)
    controlled.report(20)
    await screen.findByRole('progressbar', {
      name: `${imageUpload.list.progressLabel}: coat.png`,
    })

    expect(controlled.started()).toBe(1)
  })
})
