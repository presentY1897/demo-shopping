import type { UploadContentType } from '@shopping/shared'

import type { PixelSize } from './image-plan'
import { fitWithin, MAX_IMAGE_EDGE, smallerOf, uploadFilename } from './image-plan'

/**
 * Shrinking a photo before it is uploaded (TASK-0033 4.4).
 *
 * The pixels live behind a port. `createImageBitmap`, `OffscreenCanvas` and
 * `HTMLCanvasElement.toBlob` do not exist in jsdom, and a module that called
 * them directly could only ever be tested in a browser — so the *decisions*
 * (what size, which of the two files to send, what to call it) are pure and
 * covered by `image-plan.ts`, and this file is the thin part that asks a browser
 * to do the work.
 */

export interface ImageEncoder {
  /** The image's natural size, without producing a copy of it. */
  measure(file: Blob): Promise<PixelSize>
  /** Draws the image at `target` and encodes it as `type`. */
  encode(file: Blob, target: PixelSize, type: UploadContentType): Promise<Blob>
}

export interface PreparedImage {
  readonly body: Blob
  /** What to declare to the presign endpoint. Always agrees with `body.type`. */
  readonly filename: string
  readonly contentType: UploadContentType
  readonly size: number
  /** The size the bytes were encoded at, for the record. */
  readonly pixels: PixelSize
  /** False when the original was already small enough and was sent unchanged. */
  readonly resized: boolean
}

export interface PrepareOptions {
  readonly maxEdge?: number
}

/**
 * The file to upload, and what to declare about it.
 *
 * Three rules, in order (4.4):
 *
 * 1. an image already inside the box is **not touched** — re-encoding is lossy
 *    and buys nothing;
 * 2. the output keeps the **original format**, because presign requires the
 *    extension and the MIME type to agree and a changed format changes what the
 *    seller thinks they uploaded;
 * 3. if the resized copy is **larger** than the original, the original wins —
 *    which happens with flat PNGs more often than one would guess.
 *
 * The size cap is not enforced here. Whether 5MB is too much is `image-plan`'s
 * `exceedsSizeCap`, and the widget checks it after this returns so that the
 * failure lands on the row with the rest of them.
 */
export async function prepareImage(
  file: File,
  contentType: UploadContentType,
  encoder: ImageEncoder,
  { maxEdge = MAX_IMAGE_EDGE }: PrepareOptions = {},
): Promise<PreparedImage> {
  const filename = uploadFilename(file.name, contentType)
  const natural = await encoder.measure(file)
  const target = fitWithin(natural, maxEdge)

  if (target.width === natural.width && target.height === natural.height) {
    return { body: file, contentType, filename, pixels: natural, resized: false, size: file.size }
  }

  const encoded = await encoder.encode(file, target, contentType)
  const chosen = smallerOf<Blob>(file, encoded)
  const resized = chosen === encoded

  return {
    body: chosen,
    contentType,
    filename,
    pixels: resized ? target : natural,
    resized,
    size: chosen.size,
  }
}
