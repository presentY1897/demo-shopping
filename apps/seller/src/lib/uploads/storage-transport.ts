/**
 * Putting bytes in the bucket (TASK-0033 4.5).
 *
 * **Why `XMLHttpRequest` and not `fetch`.** `fetch` reports download progress
 * and nothing about the upload. Streaming a request body needs `duplex: 'half'`
 * and HTTP/2 and is not something every browser we care about does, while
 * `XMLHttpRequest.upload.onprogress` has worked everywhere for fifteen years.
 * A progress bar that only ever showed 0% and then 100% would be a spinner with
 * extra steps, and a 5MB upload on a phone is exactly where somebody needs to
 * see it moving.
 *
 * **Why it is a port.** A spec that wants to assert on the progress bar should
 * not have to produce progress events, and a spec that wants to assert on a
 * refusal should not have to build a bucket. The default implementation is the
 * XHR below; `uploads-mock` in `@shopping/api-mocks` answers the requests it
 * makes.
 */

/**
 * Why an upload did not land, in the categories a screen can act on.
 *
 * Storage is **not our API**: there is no error envelope, no `error.code` and no
 * `x-request-id`, so there is nothing to look a sentence up by. What there is:
 * a status, and which XHR event fired.
 */
export const STORAGE_FAILURE_REASONS = [
  /**
   * No response at all.
   *
   * A refused CORS preflight, an offline browser — **and, measured against R2,
   * an expired URL**: its 403 carries no `Access-Control-Allow-Origin`, so a
   * browser refuses to let script read it and reports the same network error it
   * reports for a dead socket (TASK-0033 4.9). The sentence for this reason has
   * to cover all three, and the recovery for all three is the same: retry, which
   * asks for a fresh URL.
   */
  'blocked',
  /**
   * 403 with a readable response.
   *
   * Reachable from Node and from a same-origin or CORS-exposing store, and it is
   * what the round-trip script and the mock bucket produce. A browser talking to
   * R2 will normally see `blocked` instead.
   */
  'rejected',
  'aborted',
  'timeout',
  /** Any other non-2xx. Rare, and worth telling apart from the three above. */
  'http',
] as const

export type StorageFailureReason = (typeof STORAGE_FAILURE_REASONS)[number]

export class StorageUploadError extends Error {
  override readonly name = 'StorageUploadError'

  constructor(
    readonly reason: StorageFailureReason,
    /** 0 when no response arrived, which is what `blocked` means. */
    readonly status: number,
  ) {
    super(`storage upload failed: ${reason} (${String(status)})`)
  }
}

export function isStorageUploadError(value: unknown): value is StorageUploadError {
  return value instanceof StorageUploadError
}

export interface StoragePutRequest {
  /** The presigned URL. Carries the signature; treat it as a secret. */
  readonly url: string
  readonly body: Blob
  /** `headers` from the presign response, sent back verbatim or it is a 403. */
  readonly headers: Readonly<Record<string, string>>
}

export interface StoragePutHooks {
  readonly onProgress?: (percent: number) => void
  readonly signal?: AbortSignal
}

export interface StoragePutResult {
  /** The bucket's entity tag, when it exposed one. Not required for anything. */
  readonly etag: string | null
}

export interface UploadTransport {
  put(request: StoragePutRequest, hooks?: StoragePutHooks): Promise<StoragePutResult>
}

/**
 * The percentage to report, or `null` when the browser cannot say.
 *
 * `lengthComputable` is false for a request whose length the browser has not
 * worked out yet; reporting 0 there would make the bar jump backwards from
 * whatever it last showed.
 */
export function progressPercent(loaded: number, total: number, computable: boolean): number | null {
  if (!computable || total <= 0) return null

  return Math.min(100, Math.round((loaded / total) * 100))
}

/** 403 is the one status that means something specific here. */
export function reasonForStatus(status: number): StorageFailureReason {
  return status === 403 ? 'rejected' : 'http'
}
