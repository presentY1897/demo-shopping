import type { PresignUploadRequest } from '@shopping/shared'
import {
  presignUploadRequestSchema,
  presignUploadResponseSchema,
  UPLOAD_URL_TTL_SECONDS,
  uploadImageFormats,
} from '@shopping/shared'
import type { RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import { mockPaths, MOCK_STORAGE_ORIGIN, MOCK_STORAGE_PUBLIC_ORIGIN } from '../paths'
import { answering, MockApiError, readBody } from './refusal'

/**
 * Presigned uploads, and the storage that receives them (TASK-0011, TASK-0033).
 *
 * **Two endpoints, and the second one is the point.** A screen that uploads
 * talks to us once and to a bucket once, and the bucket is where the
 * interesting refusals live: the signature covers `content-type` and
 * `content-length`, so an upload that sends anything else is refused with 403
 * by the storage itself rather than by us (TASK-0011 4.3). A double that
 * accepted any PUT would let a widget which forgot to send the signed headers
 * pass every test and fail on the first real image.
 *
 * So {@link uploadStore} keeps what it signed and the PUT handler checks it,
 * which is exactly what MinIO did in TASK-0011's round trip (F9) and what R2
 * does in production.
 *
 * **What is not reproduced.** The signature itself is not computed — the URL
 * carries an opaque token instead of a real SigV4 chain. Signing is `apps/api`'s
 * pure logic and is fixed against AWS's own published vectors (TASK-0011 F7);
 * re-deriving it here would be a second implementation to keep in step, and it
 * would tell a front-end spec nothing it can act on.
 */

interface SignedUpload {
  readonly key: string
  readonly contentType: string
  readonly contentLength: number
  /** Epoch millis after which the storage refuses the URL. */
  readonly expiresAt: number
}

/** Something stable to build keys from, so a spec can predict them. */
let counter = 0

class UploadStore {
  private signed = new Map<string, SignedUpload>()

  reset(): void {
    this.signed.clear()
    counter = 0
  }

  /**
   * The extension the key gets, or a refusal naming the input at fault.
   *
   * `uploadImageFormats` comes from `@shopping/shared`, so the mock refuses a
   * `.jpg` declared as `image/png` for precisely the reason the API refuses it.
   */
  sign(request: PresignUploadRequest, now: number): SignedUpload {
    const extension = request.filename.split('.').pop()?.toLowerCase() ?? ''
    const allowed = uploadImageFormats[request.contentType]

    if (!allowed.includes(extension)) {
      throw new MockApiError(400, '파일 이름의 확장자가 형식과 맞지 않습니다.', {
        code: 'INVALID',
        field: 'filename',
      })
    }

    counter += 1
    const objectId = `0192f0c2-0000-7000-8000-${String(counter).padStart(12, '0')}`
    const upload: SignedUpload = {
      contentLength: request.size,
      contentType: request.contentType,
      expiresAt: now + UPLOAD_URL_TTL_SECONDS * 1_000,
      key: `products/${request.sellerId}/${objectId}.${extension}`,
    }

    this.signed.set(upload.key, upload)

    return upload
  }

  find(key: string): SignedUpload | undefined {
    return this.signed.get(key)
  }
}

const store = new UploadStore()

/** Forgets every URL handed out. Called from `setupTestServer`. */
export function resetUploadStore(): void {
  store.reset()
}

/** `https://storage.test.invalid/shopping-test/products/…` → the key. */
function keyOf(url: string): string {
  const path = new URL(url).pathname.replace(/^\/[^/]+\//, '')

  return decodeURIComponent(path)
}

export const uploadHandlers: readonly RequestHandler[] = [
  http.post(mockPaths.uploadPresign, ({ request }) =>
    answering(async () => {
      const body = await readBody(request, presignUploadRequestSchema)
      const now = Date.now()
      const upload = store.sign(body, now)

      return HttpResponse.json(
        defineFixture(presignUploadResponseSchema, {
          upload: {
            contentLength: upload.contentLength,
            expiresAt: new Date(upload.expiresAt).toISOString(),
            headers: { 'Content-Type': upload.contentType },
            key: upload.key,
            method: 'PUT',
            publicUrl: `${MOCK_STORAGE_PUBLIC_ORIGIN}/${upload.key}`,
            uploadUrl: `${MOCK_STORAGE_ORIGIN}/shopping-test/${upload.key}?X-Amz-Signature=mock`,
          },
        }),
      )
    }),
  ),

  /**
   * The bucket.
   *
   * Answers exactly what a signed PUT can answer: 200 with an `ETag`, or 403 for
   * a URL that was never issued, has expired, or is being used with a
   * `Content-Type` or a body length other than the one it was signed for. No
   * error envelope — the storage is not our API, and a widget that expected one
   * from it would be reading a shape that never arrives.
   */
  http.put(mockPaths.storageObject, async ({ request }) => {
    const upload = store.find(keyOf(request.url))
    const body = await request.arrayBuffer()

    if (upload === undefined || Date.now() > upload.expiresAt) {
      return new HttpResponse(null, { status: 403 })
    }
    if (request.headers.get('content-type') !== upload.contentType) {
      return new HttpResponse(null, { status: 403 })
    }
    if (body.byteLength !== upload.contentLength) {
      return new HttpResponse(null, { status: 403 })
    }

    return new HttpResponse(null, { headers: { etag: `"${upload.key}"` }, status: 200 })
  }),
]
