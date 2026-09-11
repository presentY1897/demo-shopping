import { createHash } from 'node:crypto'
import { productImageKeyPattern } from '@shopping/shared'
import type { ObjectStorageConfig } from '../config/storage-config.js'
import { presignS3Request } from '../storage/sigv4.js'
import type { ThumbnailJob } from './thumbnail-queue.js'
import { THUMBNAIL_LIMITS } from './thumbnail-limits.js'

/** Only our configured bucket's immutable, owner-scoped keys may be downloaded. */
export function thumbnailTargets(job: ThumbnailJob, storage: ObjectStorageConfig, now: Date) {
  const key = thumbnailSourceKey(job, storage)
  const hash = createHash('sha256').update(key).digest('hex')
  const sign = (method: 'GET' | 'PUT', objectKey: string) =>
    presignS3Request({
      method,
      endpoint: storage.endpoint,
      path: `/${storage.bucket}/${objectKey}`,
      headers: method === 'PUT' ? { 'content-type': 'image/webp' } : {},
      accessKeyId: storage.accessKeyId,
      secretAccessKey: storage.secretAccessKey,
      region: storage.region,
      signedAt: now,
      expiresInSeconds: 60,
    }).url
  const targets = THUMBNAIL_LIMITS.edges.map((edge) => {
    const outputKey = `thumbnails/${job.sellerId}/${hash}/v1/${edge}.webp`
    return { edge, url: sign('PUT', outputKey), publicUrl: `${storage.publicBaseUrl}/${outputKey}` }
  })
  return { sourceUrl: sign('GET', key), targets }
}

export function thumbnailSourceKey(
  job: Pick<ThumbnailJob, 'sellerId' | 'sourceUrl'>,
  storage: ObjectStorageConfig,
): string {
  const prefix = `${storage.publicBaseUrl}/`
  if (!job.sourceUrl.startsWith(prefix)) throw new Error('foreign_source')
  const key = job.sourceUrl.slice(prefix.length)
  if (!productImageKeyPattern.test(key) || !key.startsWith(`products/${job.sellerId}/`))
    throw new Error('foreign_source')
  return key
}
