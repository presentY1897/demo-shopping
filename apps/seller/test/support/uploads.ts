import type {
  StoragePutHooks,
  StoragePutRequest,
  StoragePutResult,
  UploadTransport,
} from '@/lib/uploads/storage-transport'
import { reasonForStatus, StorageUploadError } from '@/lib/uploads/storage-transport'

/**
 * Upload transports for the specs (TASK-0033 4.5).
 *
 * **Why the widget's own XHR transport is not used here.** Under jsdom, msw
 * intercepts with undici, and undici does not recognise a *jsdom* `File` or
 * `Blob` as a request body: it falls back to `String(body)`, so the mock bucket
 * receives the nine bytes of the word `undefined` and refuses the upload for a
 * signed length it was never sent. The same thing happens through
 * `XMLHttpRequest`, because the interceptor is the same.
 *
 * Reading the blob into an `ArrayBuffer` inside the widget's own transport would
 * make the spec pass by pulling every file fully into memory in production —
 * a worse program for a better test. So the transport stays a port, the read
 * happens here, and what is lost is only the plumbing: the signed
 * `Content-Type` and byte length still reach the mock bucket and are still
 * checked there, and the real `XMLHttpRequest` path is verified against
 * Cloudflare R2 in a browser (TASK-0033 6.4).
 */

/**
 * A real PUT, through `fetch`, so the mock bucket sees the signed headers.
 *
 * Reports no progress — `fetch` cannot, which is the whole reason the widget
 * uses XHR. Use {@link controlledTransport} to assert on the progress bar.
 */
export function fetchUploadTransport(): UploadTransport {
  return {
    async put(request: StoragePutRequest): Promise<StoragePutResult> {
      const response = await fetch(request.url, {
        // See the note above: the bytes, not the jsdom `Blob` that holds them.
        body: await request.body.arrayBuffer(),
        headers: request.headers,
        method: 'PUT',
      })

      if (!response.ok) {
        throw new StorageUploadError(reasonForStatus(response.status), response.status)
      }

      return { etag: response.headers.get('etag') }
    },
  }
}

export interface ControlledTransport {
  readonly transport: UploadTransport
  /** Pushes a percentage at whatever upload is in flight. */
  report: (percent: number) => void
  /** Finishes the upload that is in flight. */
  finish: () => void
  fail: (error: unknown) => void
  /** How many uploads have been started. */
  started: () => number
}

/**
 * An upload that goes nowhere until the spec says so.
 *
 * The only way to observe a row *while* it is uploading — a progress bar, a
 * cancel button, a concurrency limit — is to hold the upload open, which no
 * amount of mocking at the HTTP layer can do deterministically.
 */
export function controlledTransport(): ControlledTransport {
  const inFlight: {
    resolve: (result: StoragePutResult) => void
    reject: (error: unknown) => void
    hooks: StoragePutHooks
  }[] = []

  return {
    fail: (error: unknown) => {
      inFlight.shift()?.reject(error)
    },
    finish: () => {
      inFlight.shift()?.resolve({ etag: null })
    },
    report: (percent: number) => {
      inFlight[0]?.hooks.onProgress?.(percent)
    },
    started: () => inFlight.length,
    transport: {
      put: (_request, hooks = {}) =>
        new Promise<StoragePutResult>((resolve, reject) => {
          inFlight.push({ hooks, reject, resolve })
        }),
    },
  }
}
