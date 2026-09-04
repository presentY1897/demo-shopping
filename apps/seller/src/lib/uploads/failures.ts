import { errorMessage, failureMessage, isApiFieldError, quotableRequestId } from '@shopping/shared'
import type { ApiFailure, ApiFailureReason, ErrorMessages } from '@shopping/shared'

import type { StorageFailureReason } from './storage-transport'
import { isStorageUploadError } from './storage-transport'

/**
 * Turning a failure into the sentence on one gallery row (TASK-0033 4.9).
 *
 * The widget meets failures from **two systems with different contracts**, and
 * conflating them is how a screen ends up showing an empty message.
 *
 * | source | envelope | request id |
 * | --- | --- | --- |
 * | our API (`/uploads/presign`) | `{ error: { code, message, details, requestId } }` | yes |
 * | the bucket (a presigned PUT) | none — it is not our API | no |
 *
 * So an API refusal is looked up by `error.code` in the catalog, and a storage
 * refusal is narrowed to one of five reasons the catalog also answers for. No
 * new domain code was added for any of this: `userFacingErrorCodes` is a list
 * every app's catalog must answer in full, and everything presign can refuse is
 * already sayable with the transport-layer codes.
 */

/** Failures the widget names itself, without asking anybody. */
export const localFailureKeys = [
  /** The file is not a JPEG, PNG or WebP. */
  'unsupportedType',
  /** The gallery is already at `PRODUCT_MAX_IMAGES`. */
  'tooManyImages',
  /** Still over the cap after resizing, so presign would refuse it anyway. */
  'tooLarge',
  /** The browser could not decode the file. A `.png` that is not a PNG. */
  'decodeFailed',
] as const

export type LocalFailureKey = (typeof localFailureKeys)[number]

/** Every key the catalog's `failures` record answers for. */
export type UploadFailureKey = LocalFailureKey | StorageFailureReason

export interface UploadMessages {
  readonly errors: ErrorMessages
  readonly transport: Readonly<Record<ApiFailureReason, string>>
  readonly failures: Readonly<Record<UploadFailureKey, string>>
}

/**
 * Which reason a storage error carries, or `blocked` for anything unrecognised.
 *
 * `blocked` rather than a separate "unknown": a rejected CORS preflight and a
 * thrown `TypeError` look the same from here — no response arrived — and the
 * sentence for both has to send the reader to the same place.
 */
export function storageFailureKey(error: unknown): StorageFailureReason {
  return isStorageUploadError(error) ? error.reason : 'blocked'
}

export interface RowFailure {
  readonly message: string
  /** Shown only for a failure nobody on this screen can fix (5xx). */
  readonly requestId: string | null
  /**
   * The input the API blamed, when it named one.
   *
   * The widget has rows rather than form fields, so this does not place a
   * message under a control the way `serverFieldErrors` would — it decides
   * *which row* the message belongs to, which is the same question one level up.
   */
  readonly field: string | null
}

/**
 * The sentence for a presign refusal.
 *
 * A `details[]` entry that names a field wins over the envelope: `filename` and
 * `size` are refusals about *this file*, and the entry's own code is more
 * specific than the 400 the envelope carries.
 */
export function presignFailure(failure: ApiFailure, messages: UploadMessages): RowFailure {
  const entry = failure.kind === 'http' ? failure.details.find(isApiFieldError) : undefined

  if (entry !== undefined) {
    const fromCatalog =
      entry.code === undefined ? undefined : errorMessage(messages.errors, entry.code)

    return {
      field: entry.field,
      message: fromCatalog ?? entry.message,
      requestId: quotableRequestId(failure),
    }
  }

  return {
    field: null,
    message: failureMessage(failure, { errors: messages.errors, failures: messages.transport }),
    requestId: quotableRequestId(failure),
  }
}

/** The sentence for a failure the widget or the bucket produced. */
export function localFailure(key: UploadFailureKey, messages: UploadMessages): RowFailure {
  return { field: null, message: messages.failures[key], requestId: null }
}
