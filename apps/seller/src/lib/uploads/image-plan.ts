import type { UploadContentType } from '@shopping/shared'
import { UPLOAD_MAX_BYTES, uploadContentTypes, uploadImageFormats } from '@shopping/shared'

/**
 * What to send, decided before anything is decoded or uploaded (TASK-0033 4.4).
 *
 * Every function here is pure: numbers and strings in, numbers and strings out.
 * The actual resizing needs `createImageBitmap` and a canvas, neither of which
 * exists in jsdom, so the *decisions* are separated from the pixels and it is
 * the decisions that carry the branch coverage (QUALITY-GATES Q5).
 */

/**
 * The long edge a product photo is reduced to.
 *
 * Large enough for the storefront's biggest rendering and for a zoom view, small
 * enough that a camera original stops being the thing travelling over a mobile
 * connection: a 4000-pixel, 8MB JPEG lands around 700KB at this width.
 */
export const MAX_IMAGE_EDGE = 2000

export interface PixelSize {
  readonly width: number
  readonly height: number
}

/**
 * The size after fitting inside a `max` by `max` box, aspect ratio kept.
 *
 * Never enlarges. Re-encoding an image that is already small is a lossy
 * operation that buys nothing, and a small photo blown up to the cap would be a
 * worse picture *and* a bigger file.
 */
export function fitWithin(size: PixelSize, max: number): PixelSize {
  const longest = Math.max(size.width, size.height)

  if (longest <= max) return size

  const scale = max / longest

  // `max(1, ...)` because a very wide, very short banner would otherwise round
  // its short edge to zero, and a zero-height canvas throws rather than
  // producing a small image.
  return {
    height: Math.max(1, Math.round(size.height * scale)),
    width: Math.max(1, Math.round(size.width * scale)),
  }
}

/** True for the three types `presignUploadRequestSchema` will accept. */
export function isUploadableType(type: string): type is UploadContentType {
  return (uploadContentTypes as readonly string[]).includes(type)
}

/** Over the cap the presign request would be refused for anyway. */
export function exceedsSizeCap(bytes: number): boolean {
  return bytes > UPLOAD_MAX_BYTES
}

/**
 * The smaller of the original and whatever came out of the encoder.
 *
 * A PNG screenshot re-encoded as a PNG frequently comes out **larger** — the
 * resampler adds gradients where the original had flat runs. Comparing byte
 * counts is one line and it removes a whole class of "the upload got bigger
 * after we optimised it" surprises.
 */
export function smallerOf<T extends { readonly size: number }>(
  original: T,
  candidate: T | null,
): T {
  if (candidate === null) return original

  return candidate.size < original.size ? candidate : original
}

/**
 * The extension each type is written under when the file's own name disagrees.
 *
 * A total record rather than `uploadImageFormats[type][0]`: the shared map's
 * first entry is only conventionally the canonical one, and indexing it would
 * make "what does an unknown extension become" depend on array order in another
 * package.
 */
const DEFAULT_EXTENSION: Readonly<Record<UploadContentType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Long enough for any real file name, short of `uploadFilenameSchema`'s cap. */
const MAX_STEM_LENGTH = 180

const FALLBACK_STEM = 'image'

/**
 * A file name the presign endpoint will accept for this content type.
 *
 * The API reads the name for exactly one thing — the extension — and refuses a
 * name whose extension disagrees with the declared type, contains a path
 * separator, or carries a control character (TASK-0011 4.3). A picker on Windows
 * hands back `IMG_0042.JPG`, a drag from a file manager can hand back a path,
 * and a file saved as WebP may still carry a `.png` name. All three are ours to
 * fix here rather than a 400 for somebody to puzzle over.
 */
export function uploadFilename(name: string, contentType: UploadContentType): string {
  const allowed = uploadImageFormats[contentType]
  // `slice` rather than `split(...).pop()`: the latter is typed as possibly
  // undefined, and a guard for a case that cannot happen is a branch no test can
  // reach — which is how a 100% target starts getting waived.
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim()

  // A leading dot is a name, not an extension: `.png` must not become an empty
  // stem with a valid extension.
  const dot = cleaned.lastIndexOf('.')
  const stem = dot > 0 ? cleaned.slice(0, dot) : cleaned
  const extension = dot > 0 ? cleaned.slice(dot + 1).toLowerCase() : ''

  const kept = allowed.includes(extension) ? extension : DEFAULT_EXTENSION[contentType]
  const safeStem = stem === '' ? FALLBACK_STEM : stem.slice(0, MAX_STEM_LENGTH)

  return `${safeStem}.${kept}`
}
