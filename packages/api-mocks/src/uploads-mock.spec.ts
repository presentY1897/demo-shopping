/**
 * What the upload double promises the widget that builds on it (TASK-0033).
 *
 * The valuable half is the **bucket**, not the presign call. A widget's job is
 * to reproduce the signed `Content-Type` and byte length exactly, because the
 * storage refuses anything else with a bare 403 (TASK-0011 4.3, verified against
 * MinIO as F9). A double that accepted any PUT would let a widget that dropped
 * the header pass every front-end spec and fail on the first real image.
 *
 * The presign call goes through `createApiClient`, so a response that drifted
 * from the shared schema fails here as `malformed_response` rather than reaching
 * a screen that renders it (C1·C2).
 */

import type { PresignedUpload } from '@shopping/shared'
import { createApiClient, isApiClientError, isApiFieldError } from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { setupTestServer } from './node'

setupTestServer()

const client = createApiClient({ appId: 'seller', baseUrl: 'http://api.test.invalid' })

const SELLER_ID = '0192f0c1-1111-7000-8000-000000000001'

async function presign(
  overrides: Partial<Parameters<typeof client.presignUpload>[0]> = {},
): Promise<PresignedUpload> {
  const { upload } = await client.presignUpload({
    contentType: 'image/png',
    filename: 'coat.png',
    purpose: 'product-image',
    sellerId: SELLER_ID,
    size: 3,
    ...overrides,
  })

  return upload
}

/** A PUT that reproduces the signed headers, as a widget is required to. */
function put(upload: PresignedUpload, body: BodyInit): Promise<Response> {
  return fetch(upload.uploadUrl, { body, headers: upload.headers, method: 'PUT' })
}

describe('the presign double', () => {
  it('builds the key from the store and the extension, never from the filename', async () => {
    const upload = await presign({ filename: 'my photo (1).png' })

    expect(upload.key).toMatch(new RegExp(`^products/${SELLER_ID}/[0-9a-f-]+\\.png$`))
    expect(upload.key).not.toContain('my photo')
  })

  it('answers a different key every time, because nothing is created yet', async () => {
    const [first, second] = [await presign(), await presign()]

    expect(first.key).not.toBe(second.key)
  })

  it('reports the headers the upload has to send back verbatim', async () => {
    const upload = await presign({ contentType: 'image/webp', filename: 'coat.webp' })

    expect(upload.headers).toEqual({ 'Content-Type': 'image/webp' })
    expect(upload.contentLength).toBe(3)
  })

  it('refuses an extension that disagrees with the declared type, naming the field', async () => {
    const error = await presign({ contentType: 'image/png', filename: 'coat.jpg' }).catch(
      (reason: unknown) => reason,
    )

    expect(isApiClientError(error) && error.status).toBe(400)
    expect(isApiClientError(error) && error.details.find(isApiFieldError)?.field).toBe('filename')
  })

  it('refuses a size over the cap before any URL exists', async () => {
    const error = await presign({ size: 5 * 1024 * 1024 + 1 }).catch((reason: unknown) => reason)

    expect(isApiClientError(error) && error.status).toBe(400)
  })
})

describe('the bucket double', () => {
  it('accepts a PUT that reproduces what was signed', async () => {
    const upload = await presign()
    const response = await put(upload, new Uint8Array([1, 2, 3]))

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).not.toBeNull()
  })

  it('refuses a body of a different length', async () => {
    const upload = await presign()

    expect((await put(upload, new Uint8Array([1, 2, 3, 4]))).status).toBe(403)
  })

  it('refuses a different content type', async () => {
    const upload = await presign()
    const response = await fetch(upload.uploadUrl, {
      body: new Uint8Array([1, 2, 3]),
      headers: { 'Content-Type': 'application/pdf' },
      method: 'PUT',
    })

    expect(response.status).toBe(403)
  })

  it('refuses a key it never signed', async () => {
    const upload = await presign()
    const elsewhere = upload.uploadUrl.replace('/products/', '/products-elsewhere/')
    const response = await put({ ...upload, uploadUrl: elsewhere }, new Uint8Array([1, 2, 3]))

    expect(response.status).toBe(403)
  })
})
