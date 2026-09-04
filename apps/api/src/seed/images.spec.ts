/**
 * The seam, checked without a bucket.
 *
 * F6d asks that dropping the photographs in and rerunning changes the image
 * URLs and nothing else. The two halves of that are here: the same input
 * produces the same key (so a rerun re-uses rather than re-uploads), and an
 * unconfigured store produces no pictures rather than no catalogue.
 */

import { ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it, vi, afterEach } from 'vitest'

import type { ObjectStorage, PresignUploadCommand } from '../storage/object-storage.js'
import { galleryFor, SeedImages } from './images.js'
import { seededRandom } from './random.js'

const NOW = new Date('2026-09-05T00:00:00.000Z')

/** Records what it was asked to sign, and hands back a predictable target. */
function fakeStorage(): ObjectStorage & { readonly keys: string[] } {
  const keys: string[] = []

  return {
    keys,
    presignUpload(command: PresignUploadCommand) {
      keys.push(command.key)

      return {
        uploadUrl: `https://upload.example/${command.key}?signed`,
        publicUrl: `https://cdn.example/${command.key}`,
        headers: { 'Content-Type': command.contentType },
        expiresAt: NOW,
      }
    },
    publicUrl: (key: string) => `https://cdn.example/${key}`,
  }
}

/** `HEAD` says "not there", `PUT` succeeds — a first run against a fresh bucket. */
function freshBucket(): void {
  vi.stubGlobal('fetch', (_url: string, init?: { method?: string }) =>
    Promise.resolve(
      init?.method === 'HEAD'
        ? new Response(null, { status: 404 })
        : new Response(null, { status: 200 }),
    ),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the pool', () => {
  it('uploads a placeholder per picture when no assets were dropped in', async () => {
    freshBucket()

    const storage = fakeStorage()
    // `null` repo root: there is no `assets/` to find, which is the state a
    // fresh checkout is in.
    const images = new SeedImages(storage, () => NOW, null)
    const pool = await images.pool('women-tops-tshirts', '티셔츠')

    expect(pool).toHaveLength(6)
    expect(images.report()).toMatchObject({ uploaded: 6, reused: 0, skipped: null })
    expect(images.hasAssets()).toBe(false)
  })

  it('names every object by its content, so a rerun re-uses instead of re-uploading', async () => {
    freshBucket()

    const first = fakeStorage()
    await new SeedImages(first, () => NOW, null).pool('women-tops-tshirts', '티셔츠')

    const second = fakeStorage()
    await new SeedImages(second, () => NOW, null).pool('women-tops-tshirts', '티셔츠')

    expect(second.keys).toEqual(first.keys)
    expect(first.keys.every((key) => key.startsWith('seed/catalog/'))).toBe(true)
  })

  it('keys outside `products/`, so all fifteen stores may use one picture', async () => {
    // `assertOwnImages` reads the seller id out of a `products/<id>/` key and
    // refuses another store's. A shared catalogue asset has no owner, and
    // keying it under one store would make it unusable by the other fourteen.
    freshBucket()

    const storage = fakeStorage()
    await new SeedImages(storage, () => NOW, null).pool('men-bags-cross', '크로스백')

    expect(storage.keys.some((key) => key.startsWith('products/'))).toBe(false)
  })

  it('asks the bucket once per leaf, however many listings want the pool', async () => {
    freshBucket()

    const storage = fakeStorage()
    const images = new SeedImages(storage, () => NOW, null)

    await images.pool('women-tops-knits', '니트')
    await images.pool('women-tops-knits', '니트')
    await images.pool('women-tops-knits', '니트')

    expect(storage.keys).toHaveLength(6)
  })

  it('re-uses an object the bucket already has', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 200 })))

    const images = new SeedImages(fakeStorage(), () => NOW, null)
    await images.pool('women-shoes-boots', '부츠')

    expect(images.report()).toMatchObject({ uploaded: 0, reused: 6 })
  })

  it('draws two sections in different colours, so a grid does not clash (F6c)', async () => {
    freshBucket()

    const storage = fakeStorage()
    const images = new SeedImages(storage, () => NOW, null)

    await images.pool('women-tops-knits', '니트')
    const tops = [...storage.keys]

    await images.pool('women-outer-coats', '코트')

    expect(new Set([...storage.keys].slice(tops.length))).not.toEqual(new Set(tops))
  })
})

describe('when the bucket is not configured', () => {
  it('answers no pictures rather than failing the whole seed', async () => {
    // An environment with no R2 credentials still gets 40 categories, 15 stores
    // and 800 listings. Refusing to run would take those away too.
    const refusing: ObjectStorage = {
      presignUpload: () => {
        throw new ServiceUnavailableException('이미지 저장소가 설정되지 않았습니다.')
      },
      publicUrl: () => {
        throw new ServiceUnavailableException('이미지 저장소가 설정되지 않았습니다.')
      },
    }

    const images = new SeedImages(refusing, () => NOW, null)

    expect(await images.pool('women-tops-tshirts', '티셔츠')).toEqual([])
    expect(images.report().skipped).toContain('R2')
  })
})

describe('galleryFor', () => {
  const pool = Array.from({ length: 6 }, (_unused, index) => ({
    url: `https://cdn.example/${String(index)}.svg`,
    alt: `사진 ${String(index)}`,
  }))

  it('gives a showcase listing the full gallery F6b asks for', () => {
    const random = seededRandom('갤러리')

    for (let index = 0; index < 30; index += 1) {
      expect(galleryFor(random, pool, true).length).toBeGreaterThanOrEqual(4)
    }
  })

  it('gives an ordinary listing one or two', () => {
    const random = seededRandom('갤러리')

    for (let index = 0; index < 30; index += 1) {
      const gallery = galleryFor(random, pool, false)

      expect(gallery.length).toBeGreaterThanOrEqual(1)
      expect(gallery.length).toBeLessThanOrEqual(2)
    }
  })

  it('never repeats a picture inside one gallery', () => {
    const random = seededRandom('갤러리')

    for (let index = 0; index < 30; index += 1) {
      const gallery = galleryFor(random, pool, true)

      expect(new Set(gallery.map((image) => image.url)).size).toBe(gallery.length)
    }
  })

  it('answers nothing when there were no pictures to draw from', () => {
    expect(galleryFor(seededRandom('갤러리'), [], true)).toEqual([])
  })
})
