import type { ImageEncoder } from './prepare-image'

/**
 * The browser half of the resize (TASK-0033 4.4).
 *
 * Its own file because it is the only thing here that **cannot run in a spec**:
 * jsdom has no `createImageBitmap` and no canvas. Keeping it apart is what lets
 * `prepare-image.ts` and the modules around it carry a 100% branch target
 * honestly, instead of the target being waived for a file that is 60%
 * unreachable. What is in here is verified in a real browser against the real
 * bucket (6.4).
 */

/** Quality for the lossy formats. High enough that a product photo survives it. */
const ENCODE_QUALITY = 0.9

/**
 * The browser's own decoder and canvas.
 *
 * `createImageBitmap` rather than an `<img>` with an `onload`: it decodes off
 * the main thread, it does not need the element to be in a document, and it
 * fails with a rejected promise instead of an event nobody remembered to
 * listen for. A file that is not really an image lands there — which is the
 * `decodeFailed` row.
 */
export function browserImageEncoder(): ImageEncoder {
  return {
    async encode(file, target, type) {
      const bitmap = await createImageBitmap(file, {
        resizeHeight: target.height,
        resizeQuality: 'high',
        resizeWidth: target.width,
      })

      try {
        const canvas = document.createElement('canvas')
        canvas.width = target.width
        canvas.height = target.height

        const context = canvas.getContext('2d')

        if (context === null) throw new Error('2d canvas context unavailable')

        context.drawImage(bitmap, 0, 0, target.width, target.height)

        return await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (blob) => {
              if (blob === null) reject(new Error('canvas produced no blob'))
              else resolve(blob)
            },
            type,
            ENCODE_QUALITY,
          )
        })
      } finally {
        bitmap.close()
      }
    },

    async measure(file) {
      const bitmap = await createImageBitmap(file)

      try {
        return { height: bitmap.height, width: bitmap.width }
      } finally {
        bitmap.close()
      }
    },
  }
}
