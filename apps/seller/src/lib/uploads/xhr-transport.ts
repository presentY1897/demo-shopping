import type { StoragePutResult, UploadTransport } from './storage-transport'
import { progressPercent, reasonForStatus, StorageUploadError } from './storage-transport'

/**
 * The `XMLHttpRequest` that actually moves the bytes (TASK-0033 4.5).
 *
 * Its own file for the same reason as `browser-image-encoder.ts`: under jsdom,
 * msw intercepts with undici, and undici does not recognise a jsdom `Blob` as a
 * request body — so this cannot be exercised in a spec without changing it into
 * something worse. It is verified in a real browser against Cloudflare R2 (6.4),
 * and everything a spec can reach lives in `storage-transport.ts`.
 */

/**
 * Long enough for 5MB on a slow connection, short enough that a dead socket does
 * not leave a row spinning forever. The presigned URL itself expires in five
 * minutes, so waiting longer than this could only ever end in a 403.
 */
const UPLOAD_TIMEOUT_MS = 120_000

export function xhrUploadTransport(): UploadTransport {
  return {
    put(request, hooks = {}) {
      return new Promise<StoragePutResult>((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        xhr.open('PUT', request.url, true)
        xhr.timeout = UPLOAD_TIMEOUT_MS

        for (const [name, value] of Object.entries(request.headers)) {
          xhr.setRequestHeader(name, value)
        }

        xhr.upload.addEventListener('progress', (event: ProgressEvent) => {
          const percent = progressPercent(event.loaded, event.total, event.lengthComputable)

          if (percent !== null) hooks.onProgress?.(percent)
        })

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve({ etag: xhr.getResponseHeader('etag') })
            return
          }

          reject(new StorageUploadError(reasonForStatus(xhr.status), xhr.status))
        })

        // A refused preflight and an unplugged cable are the same event with the
        // same empty status, which is why `blocked` names both.
        xhr.addEventListener('error', () => {
          reject(new StorageUploadError('blocked', xhr.status))
        })
        xhr.addEventListener('timeout', () => {
          reject(new StorageUploadError('timeout', 0))
        })
        xhr.addEventListener('abort', () => {
          reject(new StorageUploadError('aborted', 0))
        })

        hooks.signal?.addEventListener(
          'abort',
          () => {
            xhr.abort()
          },
          { once: true },
        )

        xhr.send(request.body)
      })
    },
  }
}
