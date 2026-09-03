import { ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import type { ObjectStorageConfig } from '../config/storage-config.js'
import {
  createObjectStorage,
  S3CompatibleObjectStorage,
  UnconfiguredObjectStorage,
} from './object-storage.js'

const CONFIG: ObjectStorageConfig = {
  endpoint: 'https://account.r2.cloudflarestorage.com',
  bucket: 'shopping-dev',
  region: 'auto',
  accessKeyId: 'access-key-id',
  secretAccessKey: 'secret-access-key',
  publicBaseUrl: 'https://cdn.demo-shopping.com',
}

const KEY = 'products/0192f0c1-0000-7000-8000-0000000a0001/0192f0c2-0000-7000-8000-0000000b0002.png'

const COMMAND = {
  key: KEY,
  contentType: 'image/png',
  contentLength: 1024,
  now: new Date('2026-09-03T00:00:00.000Z'),
  expiresInSeconds: 300,
}

describe('an S3 compatible bucket', () => {
  const storage = new S3CompatibleObjectStorage(CONFIG)

  it('addresses the object path-style, bucket first', () => {
    // Virtual-host style would work too, but it puts the bucket name into the
    // signed host — renaming a bucket would then also change the signature.
    expect(storage.presignUpload(COMMAND).uploadUrl).toContain(
      `https://account.r2.cloudflarestorage.com/shopping-dev/${KEY}?`,
    )
  })

  it('signs both the length and the type', () => {
    expect(storage.presignUpload(COMMAND).uploadUrl).toContain(
      'X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost',
    )
  })

  it('asks the caller for the one header a browser will let it set', () => {
    // `Content-Length` is signed but omitted here: it is a forbidden header
    // name, so a browser fills it in from the body and script cannot.
    expect(storage.presignUpload(COMMAND).headers).toEqual({ 'Content-Type': 'image/png' })
  })

  it('dates the deadline from the instant it was handed (F8)', () => {
    expect(storage.presignUpload(COMMAND).expiresAt.toISOString()).toBe('2026-09-03T00:05:00.000Z')
  })

  it('produces the same URL twice for the same instant (F8)', () => {
    expect(storage.presignUpload(COMMAND).uploadUrl).toBe(storage.presignUpload(COMMAND).uploadUrl)
  })

  it('reads the object from the public base URL, not from the S3 endpoint', () => {
    expect(storage.presignUpload(COMMAND).publicUrl).toBe(`https://cdn.demo-shopping.com/${KEY}`)
    expect(storage.publicUrl(KEY)).toBe(`https://cdn.demo-shopping.com/${KEY}`)
  })
})

describe('a bucket that does not exist yet (F11)', () => {
  const storage = new UnconfiguredObjectStorage()

  it('refuses to presign, with the status that means "not now"', () => {
    expect(() => storage.presignUpload()).toThrow(ServiceUnavailableException)
  })

  it('refuses to name a public URL either', () => {
    // Otherwise a caller could build a link into a bucket nobody has created.
    expect(() => storage.publicUrl()).toThrow(ServiceUnavailableException)
  })

  it('says why in a sentence a person can act on', () => {
    expect(() => storage.presignUpload()).toThrow('이미지 저장소가 설정되지 않아')
  })
})

describe('choosing an implementation', () => {
  it('takes the unconfigured one when there is no configuration', () => {
    expect(createObjectStorage(null)).toBeInstanceOf(UnconfiguredObjectStorage)
  })

  it('takes the real one when there is', () => {
    expect(createObjectStorage(CONFIG)).toBeInstanceOf(S3CompatibleObjectStorage)
  })
})
