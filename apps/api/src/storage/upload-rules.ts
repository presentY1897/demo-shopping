import type { UploadContentType } from '@shopping/shared'
import { productImageKeyPattern, uploadImageExtensions, uploadImageFormats } from '@shopping/shared'

/**
 * What may be uploaded, decided from the request alone (TASK-0011 4.3).
 *
 * Pure functions with no clock, no database and no configuration, because these
 * are the rules a reviewer has to be able to read in one sitting: which formats,
 * which name, which key. `packages/shared` owns the *values* (so the front-ends
 * validate against the same ones); this file owns what to do with them.
 *
 * Size is not checked here — `uploadSizeSchema` refuses an over-large request
 * before it reaches any of this, and the real enforcement is the signed
 * `content-length` header rather than either check (TASK-0011 4.3).
 */

/**
 * The extension of a filename, lowercased, or `null` when it has none.
 *
 * A leading dot does not count: `.env` is a name, not an extension, and treating
 * it as one would make `.png` a valid upload with an empty name.
 */
export function extensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf('.')

  if (dot <= 0 || dot === filename.length - 1) return null

  return filename.slice(dot + 1).toLowerCase()
}

export type UploadRuleResult =
  | { readonly ok: true; readonly extension: string }
  /** Korean, because it reaches the caller as a `details` entry of a 400. */
  | { readonly ok: false; readonly reason: string }

const ALLOWED_LIST = uploadImageExtensions.join(' · ')

/**
 * Decides the extension an upload will be stored under.
 *
 * Two separate refusals rather than one, because they mean different things: an
 * unsupported extension is a file the user should not have picked, while a
 * mismatch between extension and declared type is a request that contradicts
 * itself — usually a client bug, occasionally an attempt to land a `.png` key on
 * something that is not a PNG.
 */
export function resolveUploadExtension(
  filename: string,
  contentType: UploadContentType,
): UploadRuleResult {
  const extension = extensionOf(filename)

  if (extension === null) {
    return { ok: false, reason: `파일 이름에 확장자가 없습니다. (${ALLOWED_LIST})` }
  }
  if (!uploadImageExtensions.includes(extension)) {
    return { ok: false, reason: `지원하지 않는 확장자입니다. ${ALLOWED_LIST} 만 올릴 수 있습니다.` }
  }
  if (!uploadImageFormats[contentType].includes(extension)) {
    return {
      ok: false,
      reason: `확장자 .${extension} 와(과) 형식 ${contentType} 이(가) 일치하지 않습니다.`,
    }
  }

  return { ok: true, extension }
}

/**
 * `products/{sellerId}/{objectId}.{ext}`.
 *
 * Assembled here and never taken from the request: a client that chooses its own
 * key turns every future change into a hunt for a way to reach another store's
 * prefix, and no amount of validation ends that game. The caller supplies the
 * store it was authorised for and a fresh object id, and there is nothing left
 * to escape from.
 *
 * The result is checked against the shared pattern rather than trusted, so that
 * the one shape the rest of the system matches on is the one actually produced —
 * a `sellerId` that is not a UUID fails here instead of becoming a key nothing
 * can parse later.
 */
export function productImageKey(sellerId: string, objectId: string, extension: string): string {
  const key = `products/${sellerId}/${objectId}.${extension}`

  if (!productImageKeyPattern.test(key)) {
    throw new Error(`생성된 스토리지 키가 규칙에 맞지 않습니다: ${key}`)
  }

  return key
}
