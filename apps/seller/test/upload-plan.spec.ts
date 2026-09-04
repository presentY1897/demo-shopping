/**
 * The decisions the upload widget makes before it touches a network
 * (TASK-0033 4.3, 4.4).
 *
 * These are the modules QUALITY-GATES calls 순수 로직 — input to output, no
 * clock, no fetch, no React — so they carry **branch coverage 100%** while the
 * screen above them is measured by the interaction list instead. Splitting them
 * out is what makes the resize decision testable at all: the pixels need a
 * canvas, and jsdom has none.
 */

import {
  ApiClientError,
  ApiConfigurationError,
  apiFailure,
  errorMessage,
  failureMessage,
  PRODUCT_MAX_IMAGES,
  quotableRequestId,
  UPLOAD_MAX_BYTES,
} from '@shopping/shared'
import type { ImageUploadStatus } from '@shopping/ui/components'
import { describe, expect, it } from 'vitest'
import type { ApiFailure } from '@shopping/shared'

import type { UploadMessages } from '@/lib/uploads/failures'
import { localFailure, presignFailure, storageFailureKey } from '@/lib/uploads/failures'
import type { GalleryEntry } from '@/lib/uploads/gallery'
import {
  admitFiles,
  failedIds,
  galleryImages,
  indexOf,
  isBusy,
  moveEntry,
  patchEntry,
  promoteEntry,
  readyToStart,
  removeEntry,
} from '@/lib/uploads/gallery'
import {
  exceedsSizeCap,
  fitWithin,
  isUploadableType,
  smallerOf,
  uploadFilename,
} from '@/lib/uploads/image-plan'
import { prepareImage } from '@/lib/uploads/prepare-image'
import {
  progressPercent,
  reasonForStatus,
  StorageUploadError,
} from '@/lib/uploads/storage-transport'
import { ko } from '@/messages/ko'

const MESSAGES: UploadMessages = {
  errors: ko.errors,
  failures: ko.imageUpload.failures,
  transport: ko.apiFailures,
}

function file(name: string, type = 'image/png', size = 3): File {
  const blob = new File([new Uint8Array(size)], name, { type })

  return blob
}

function entry(id: string, status: ImageUploadStatus, url?: string): GalleryEntry {
  return { file: file(`${id}.png`), id, name: `${id}.png`, previewUrl: '', status, url }
}

describe('fitWithin', () => {
  it('leaves an image that already fits alone', () => {
    expect(fitWithin({ height: 800, width: 1200 }, 2000)).toEqual({ height: 800, width: 1200 })
  })

  it('leaves an image exactly at the limit alone', () => {
    expect(fitWithin({ height: 2000, width: 2000 }, 2000)).toEqual({ height: 2000, width: 2000 })
  })

  it('caps the long edge when it is the width', () => {
    expect(fitWithin({ height: 2000, width: 4000 }, 2000)).toEqual({ height: 1000, width: 2000 })
  })

  it('caps the long edge when it is the height', () => {
    expect(fitWithin({ height: 4000, width: 1000 }, 2000)).toEqual({ height: 2000, width: 500 })
  })

  it('never rounds the short edge down to zero', () => {
    // A 8000x2 banner scaled by 0.25 would put the height at 0.5 and a
    // zero-height canvas throws instead of producing a picture.
    expect(fitWithin({ height: 2, width: 8000 }, 2000).height).toBe(1)
  })
})

describe('isUploadableType', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (type) => {
    expect(isUploadableType(type)).toBe(true)
  })

  it.each(['image/gif', 'image/svg+xml', 'application/pdf', ''])('refuses %s', (type) => {
    expect(isUploadableType(type)).toBe(false)
  })
})

describe('exceedsSizeCap', () => {
  it('allows a file exactly at the cap', () => {
    expect(exceedsSizeCap(UPLOAD_MAX_BYTES)).toBe(false)
  })

  it('refuses one byte more', () => {
    expect(exceedsSizeCap(UPLOAD_MAX_BYTES + 1)).toBe(true)
  })
})

describe('smallerOf', () => {
  it('keeps the original when nothing was encoded', () => {
    const original = { size: 10 }

    expect(smallerOf(original, null)).toBe(original)
  })

  it('takes the encoded copy when it is smaller', () => {
    const encoded = { size: 4 }

    expect(smallerOf({ size: 10 }, encoded)).toBe(encoded)
  })

  it('keeps the original when the encoded copy grew', () => {
    const original = { size: 10 }

    expect(smallerOf(original, { size: 11 })).toBe(original)
  })

  it('keeps the original on a tie, because re-encoding is lossy for nothing', () => {
    const original = { size: 10 }

    expect(smallerOf(original, { size: 10 })).toBe(original)
  })
})

describe('uploadFilename', () => {
  it('keeps a name whose extension already agrees', () => {
    expect(uploadFilename('coat.png', 'image/png')).toBe('coat.png')
  })

  it('lowercases an extension a picker shouted', () => {
    expect(uploadFilename('IMG_0042.JPG', 'image/jpeg')).toBe('IMG_0042.jpg')
  })

  it('accepts either spelling of a JPEG', () => {
    expect(uploadFilename('coat.jpeg', 'image/jpeg')).toBe('coat.jpeg')
  })

  it('replaces an extension that disagrees with the type', () => {
    expect(uploadFilename('coat.png', 'image/webp')).toBe('coat.webp')
  })

  it('gives a name with no extension one', () => {
    expect(uploadFilename('coat', 'image/png')).toBe('coat.png')
  })

  it('treats a leading dot as a name rather than an extension', () => {
    expect(uploadFilename('.png', 'image/png')).toBe('.png.png')
  })

  it('drops a path a drag handed over', () => {
    expect(uploadFilename('C:\\photos\\coat.png', 'image/png')).toBe('coat.png')
    expect(uploadFilename('/home/me/coat.png', 'image/png')).toBe('coat.png')
  })

  it('strips control characters, which the schema refuses outright', () => {
    expect(uploadFilename('co\u0000at\u001f.png', 'image/png')).toBe('coat.png')
  })

  it('falls back to a stem when stripping left nothing', () => {
    expect(uploadFilename('\u0000', 'image/png')).toBe('image.png')
  })

  it('keeps the whole name under the schema cap', () => {
    expect(uploadFilename(`${'a'.repeat(500)}.png`, 'image/png').length).toBeLessThanOrEqual(200)
  })
})

describe('prepareImage', () => {
  const encoder = {
    encode: (_file: Blob, target: { width: number; height: number }) =>
      Promise.resolve(new Blob([new Uint8Array(target.width)], { type: 'image/png' })),
    measure: () => Promise.resolve({ height: 3000, width: 4000 }),
  }

  it('sends the original untouched when it already fits', async () => {
    const original = file('coat.png', 'image/png', 100)
    const prepared = await prepareImage(original, 'image/png', {
      ...encoder,
      measure: () => Promise.resolve({ height: 600, width: 800 }),
    })

    expect(prepared.resized).toBe(false)
    expect(prepared.body).toBe(original)
    expect(prepared.pixels).toEqual({ height: 600, width: 800 })
  })

  it('sends the resized copy when it came out smaller', async () => {
    const prepared = await prepareImage(file('coat.png', 'image/png', 9_000), 'image/png', encoder)

    expect(prepared.resized).toBe(true)
    expect(prepared.pixels).toEqual({ height: 1500, width: 2000 })
    expect(prepared.size).toBe(2000)
  })

  it('keeps the original when the resized copy grew', async () => {
    const original = file('flat.png', 'image/png', 10)
    const prepared = await prepareImage(original, 'image/png', encoder)

    expect(prepared.resized).toBe(false)
    expect(prepared.body).toBe(original)
  })

  it('names the file for the declared type', async () => {
    const prepared = await prepareImage(file('coat.PNG', 'image/png', 9_000), 'image/png', encoder)

    expect(prepared.filename).toBe('coat.png')
  })
})

describe('progressPercent', () => {
  it('rounds the ratio', () => {
    expect(progressPercent(1, 3, true)).toBe(33)
  })

  it('never exceeds 100', () => {
    expect(progressPercent(120, 100, true)).toBe(100)
  })

  it('says nothing when the browser cannot compute a length', () => {
    expect(progressPercent(10, 0, false)).toBeNull()
  })

  it('says nothing for a zero length body rather than dividing by it', () => {
    expect(progressPercent(0, 0, true)).toBeNull()
  })
})

describe('reasonForStatus', () => {
  it('calls a 403 a refusal, because that is the signed-header check', () => {
    expect(reasonForStatus(403)).toBe('rejected')
  })

  it('calls anything else plain HTTP', () => {
    expect(reasonForStatus(500)).toBe('http')
  })
})

describe('the gallery', () => {
  const entries = [entry('a', 'uploaded', 'u/a'), entry('b', 'uploading'), entry('c', 'failed')]

  it('finds a row by id and reports a miss as -1', () => {
    expect(indexOf(entries, 'b')).toBe(1)
    expect(indexOf(entries, 'zz')).toBe(-1)
  })

  it('moves a row one place', () => {
    expect(moveEntry(entries, 'b', -1).map((row) => row.id)).toEqual(['b', 'a', 'c'])
    expect(moveEntry(entries, 'b', 1).map((row) => row.id)).toEqual(['a', 'c', 'b'])
  })

  it('does nothing at either end, or for a row that is gone', () => {
    expect(moveEntry(entries, 'a', -1)).toBe(entries)
    expect(moveEntry(entries, 'c', 1)).toBe(entries)
    expect(moveEntry(entries, 'zz', 1)).toBe(entries)
  })

  it('promotes a row to the front, which is what primary means', () => {
    expect(promoteEntry(entries, 'c').map((row) => row.id)).toEqual(['c', 'a', 'b'])
  })

  it('does nothing when the row is already first, or is gone', () => {
    expect(promoteEntry(entries, 'a')).toBe(entries)
    expect(promoteEntry(entries, 'zz')).toBe(entries)
  })

  it('removes a row', () => {
    expect(removeEntry(entries, 'b').map((row) => row.id)).toEqual(['a', 'c'])
  })

  it('patches one row and leaves the others identical', () => {
    const patched = patchEntry(entries, 'b', { progress: 40 })

    expect(patched[1]?.progress).toBe(40)
    expect(patched[0]).toBe(entries[0])
  })

  it('carries only uploaded rows into the save request, in order', () => {
    const done = [
      entry('a', 'uploaded', 'u/a'),
      entry('b', 'failed'),
      entry('c', 'uploaded', 'u/c'),
    ]

    expect(galleryImages(done)).toEqual([{ url: 'u/a' }, { url: 'u/c' }])
  })

  it('leaves out an uploaded row with no URL, which should not exist', () => {
    expect(galleryImages([entry('a', 'uploaded')])).toEqual([])
  })

  it('is busy while anything is queued or running, and idle otherwise', () => {
    expect(isBusy([entry('a', 'queued')])).toBe(true)
    expect(isBusy([entry('a', 'preparing')])).toBe(true)
    expect(isBusy([entry('a', 'uploaded'), entry('b', 'failed')])).toBe(false)
  })

  it('lists the failed rows for the retry-all button', () => {
    expect(failedIds(entries)).toEqual(['c'])
  })
})

describe('readyToStart', () => {
  it('fills every free slot', () => {
    const queued = [entry('a', 'queued'), entry('b', 'queued'), entry('c', 'queued')]

    expect(readyToStart(queued, 3)).toEqual(['a', 'b', 'c'])
  })

  it('leaves the rest waiting', () => {
    const queued = [entry('a', 'queued'), entry('b', 'queued'), entry('c', 'queued')]

    expect(readyToStart(queued, 2)).toEqual(['a', 'b'])
  })

  it('counts the rows already running against the limit', () => {
    const mixed = [entry('a', 'uploading'), entry('b', 'requesting'), entry('c', 'queued')]

    expect(readyToStart(mixed, 2)).toEqual([])
  })

  it('never returns a negative number of slots', () => {
    const over = [entry('a', 'uploading'), entry('b', 'uploading'), entry('c', 'queued')]

    expect(readyToStart(over, 1)).toEqual([])
  })

  it('ignores rows that are finished or failed', () => {
    const done = [entry('a', 'uploaded'), entry('b', 'failed'), entry('c', 'queued')]

    expect(readyToStart(done, 3)).toEqual(['c'])
  })
})

describe('admitFiles', () => {
  it('accepts what fits', () => {
    const admission = admitFiles([file('a.png'), file('b.png')], 0, PRODUCT_MAX_IMAGES)

    expect(admission.accepted).toHaveLength(2)
    expect(admission.rejected).toEqual([])
  })

  it('names the file it refused and why', () => {
    const admission = admitFiles([file('a.gif', 'image/gif')], 0, PRODUCT_MAX_IMAGES)

    expect(admission.rejected).toEqual([{ name: 'a.gif', reason: 'unsupportedType' }])
  })

  it('counts what is already in the gallery against the cap', () => {
    const admission = admitFiles([file('a.png'), file('b.png')], 9, PRODUCT_MAX_IMAGES)

    expect(admission.accepted.map((entered) => entered.name)).toEqual(['a.png'])
    expect(admission.rejected).toEqual([{ name: 'b.png', reason: 'tooManyImages' }])
  })
})

describe('reading a failure', () => {
  it('calls anything that is not an API error unknown', () => {
    expect(apiFailure(new Error('boom'))).toEqual({ kind: 'transport', reason: 'unknown' })
  })

  it('names a missing API address as a configuration problem', () => {
    expect(apiFailure(new ApiConfigurationError('no base url'))).toEqual({
      kind: 'transport',
      reason: 'configuration',
    })
  })

  it('passes a transport failure through under its own name', () => {
    const error = new ApiClientError({ kind: 'timeout', message: 'too slow' })

    expect(apiFailure(error)).toEqual({ kind: 'transport', reason: 'timeout' })
  })

  it('calls an answer it could not parse a malformed response', () => {
    // A proxy's HTML error page: the status arrived, the envelope did not, and
    // there is no code to branch on.
    const error = new ApiClientError({ kind: 'http', message: 'bad gateway', status: 502 })

    expect(apiFailure(error)).toEqual({ kind: 'transport', reason: 'malformed_response' })
  })

  it('reports a status of zero when the client never recorded one', () => {
    const error = new ApiClientError({
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          details: [],
          message: '문제가 생겼습니다.',
          requestId: 'r-2',
        },
      },
      kind: 'http',
      message: 'server error',
    })

    // Without a status there is nothing to compare against 500, so the failure
    // is one the seller is *not* offered a number for.
    expect(apiFailure(error)).toMatchObject({ status: 0 })
    expect(quotableRequestId(apiFailure(error))).toBeNull()
  })

  it('reads the envelope when the API sent one', () => {
    const error = new ApiClientError({
      body: {
        error: {
          code: 'AUTH_REQUIRED',
          details: [],
          message: '로그인이 필요해요.',
          requestId: 'r-1',
        },
      },
      kind: 'http',
      message: 'unauthorized',
      requestId: 'r-1',
      status: 401,
    })

    expect(apiFailure(error)).toEqual({
      code: 'AUTH_REQUIRED',
      details: [],
      kind: 'http',
      message: '로그인이 필요해요.',
      requestId: 'r-1',
      status: 401,
    })
  })

  it('says a storage error it does not recognise was blocked', () => {
    expect(storageFailureKey(new TypeError('Failed to fetch'))).toBe('blocked')
  })

  it('reads the reason a storage error carries', () => {
    expect(storageFailureKey(new StorageUploadError('rejected', 403))).toBe('rejected')
  })

  it('uses the catalog sentence for a code the console knows', () => {
    const failure: ApiFailure = {
      code: 'AUTH_REQUIRED',
      details: [],
      kind: 'http',
      message: '서버가 쓴 문장',
      requestId: 'r-1',
      status: 401,
    }

    expect(failureMessage(failure, { errors: ko.errors, failures: ko.apiFailures })).toBe(
      ko.errors.AUTH_REQUIRED,
    )
  })

  it("falls back to the server's own sentence for a code it has never heard of", () => {
    const failure: ApiFailure = {
      code: 'ORDER_ALREADY_SHIPPED',
      details: [],
      kind: 'http',
      message: '이미 발송된 주문입니다.',
      requestId: null,
      status: 409,
    }

    expect(failureMessage(failure, { errors: ko.errors, failures: ko.apiFailures })).toBe(
      '이미 발송된 주문입니다.',
    )
    expect(errorMessage(ko.errors, 'ORDER_ALREADY_SHIPPED')).toBeUndefined()
  })

  it('offers a request id only for a failure nobody here can fix', () => {
    const server: ApiFailure = {
      code: 'INTERNAL_ERROR',
      details: [],
      kind: 'http',
      message: '',
      requestId: 'r-9',
      status: 500,
    }
    const refusal: ApiFailure = { ...server, code: 'BAD_REQUEST', status: 400 }

    expect(quotableRequestId(server)).toBe('r-9')
    expect(quotableRequestId(refusal)).toBeNull()
    expect(quotableRequestId({ kind: 'transport', reason: 'network' })).toBeNull()
  })

  it('prefers the entry that names the input over the envelope', () => {
    const failure: ApiFailure = {
      code: 'BAD_REQUEST',
      details: [{ code: 'UNSUPPORTED_MEDIA_TYPE', field: 'filename', message: '서버 문장' }],
      kind: 'http',
      message: '요청 형식이 올바르지 않습니다.',
      requestId: null,
      status: 400,
    }

    expect(presignFailure(failure, MESSAGES)).toEqual({
      field: 'filename',
      message: ko.errors.UNSUPPORTED_MEDIA_TYPE,
      requestId: null,
    })
  })

  it("uses the entry's own sentence when the catalog has no code for it", () => {
    const failure: ApiFailure = {
      code: 'BAD_REQUEST',
      details: [{ field: 'size', message: 'size 값이 올바르지 않습니다.' }],
      kind: 'http',
      message: '요청 형식이 올바르지 않습니다.',
      requestId: null,
      status: 400,
    }

    expect(presignFailure(failure, MESSAGES).message).toBe('size 값이 올바르지 않습니다.')
  })

  it('falls back to the envelope when no entry names an input', () => {
    const failure: ApiFailure = { kind: 'transport', reason: 'network' }

    expect(presignFailure(failure, MESSAGES)).toEqual({
      field: null,
      message: ko.apiFailures.network,
      requestId: null,
    })
  })

  it('takes a local failure straight from the catalog, with no number to quote', () => {
    expect(localFailure('tooLarge', MESSAGES)).toEqual({
      field: null,
      message: ko.imageUpload.failures.tooLarge,
      requestId: null,
    })
  })
})
