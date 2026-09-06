import type { ApiClient, PresignUploadRequest } from '@shopping/shared'
import {
  ApiClientError,
  presignUploadResponseSchema,
  UPLOAD_MAX_BYTES,
  UPLOAD_URL_TTL_SECONDS,
} from '@shopping/shared'
import { describe, expect, it } from 'vitest'

import { deniedMessage } from '../../src/auth/access-denied.js'
import { useApiApp } from '../support/api-app.js'
import { testStorageConfig } from '../support/app-config.js'
import { useDatabase } from '../support/database.js'
import { createSeller, createUser } from '../support/factories.js'
import type { TestCaller } from '../support/principal.js'
import { callers } from '../support/principal.js'

/**
 * `POST /api/v1/uploads/presign` over real HTTP, against this worker's real
 * database (TASK-0011 · gates A2·A3·A4·A6·C3).
 *
 * Every call goes through `createApiClient`, which parses the answer with the
 * schema the front-ends are typed against, so C3 holds structurally: a renamed
 * field fails here as `malformed_response` whether or not an assertion mentions
 * it.
 *
 * R2 itself is never contacted — presigning is pure computation, and
 * QUALITY-GATES 6장 keeps the bucket out of the suite. What *is* real: the
 * database the store is read from, the permission layer, and the signature. The
 * round trip against a live S3 implementation is
 * `scripts/verify-presign-roundtrip.mjs`, run by hand.
 */

const db = useDatabase()
const api = useApiApp({ database: db, authenticate: true })

/** A store, and its owner. Demo-owned when asked, for the `demo` scope. */
async function createStore(options: { readonly demoOwner?: boolean } = {}): Promise<string> {
  const owner = await createUser(db, { isDemo: options.demoOwner ?? false })
  const seller = await createSeller(db, { userId: owner.id })

  return seller.id
}

/** The owner of `sellerId`, as a caller. */
function sellerOf(sellerId: string): TestCaller {
  return { ...callers.seller, sellerId }
}

/**
 * An account that exists, as a caller holding `roles`.
 *
 * A return photo is authorised against the caller's **own `User` row**, so the
 * fixed ids in `callers` are not enough for that purpose — the row has to be
 * there. Product images never read one, which is why the older describes below
 * still call as `callers.*` directly.
 */
async function accountAs(
  roles: TestCaller['roles'],
  options: { readonly isDemo?: boolean } = {},
): Promise<TestCaller> {
  const account = await createUser(db, { isDemo: options.isDemo ?? false })

  return { userId: account.id, roles }
}

type ProductImageRequest = Extract<PresignUploadRequest, { purpose: 'product-image' }>
type ReturnPhotoRequest = Extract<PresignUploadRequest, { purpose: 'return-photo' }>

/**
 * One builder per purpose, because the body is a union and not a record with an
 * optional owner.
 *
 * A single builder would have to carry `sellerId` and drop it for return
 * photos, which is the very thing the contract removed: the return branch has
 * no owner field at all, so a spec cannot accidentally state one and then
 * assert that the server ignored it (TASK-0067 F2).
 */
function request(overrides: Partial<ProductImageRequest> = {}): ProductImageRequest {
  return {
    purpose: 'product-image',
    sellerId: '0192f0c1-0000-7000-8000-0000000a0001',
    filename: '가을-니트.png',
    contentType: 'image/png',
    size: 204_800,
    ...overrides,
  }
}

function photoRequest(overrides: Partial<ReturnPhotoRequest> = {}): ReturnPhotoRequest {
  return {
    purpose: 'return-photo',
    filename: '터진-박음질.png',
    contentType: 'image/png',
    size: 204_800,
    ...overrides,
  }
}

interface HttpFailure {
  readonly status: number
  readonly code: string
  readonly details: readonly unknown[]
}

/** Asserts the call failed over HTTP and returns the shared error envelope. */
async function failure(work: Promise<unknown>): Promise<HttpFailure> {
  const error: unknown = await work.then(
    () => null,
    (reason: unknown) => reason,
  )

  if (!(error instanceof ApiClientError) || error.kind !== 'http') {
    throw new Error(`HTTP 오류를 기대했지만 다른 결과가 나왔습니다: ${String(error)}`)
  }

  return {
    status: error.status ?? 0,
    code: error.body?.error.code ?? '',
    details: error.body?.error.details ?? [],
  }
}

/** The query parameters of a presigned URL, as the storage will read them. */
function signedQuery(url: string): URLSearchParams {
  return new URL(url).searchParams
}

describe('issuing a presigned upload (F1)', () => {
  it('answers with a key under the store, an upload URL and a public URL', async () => {
    const sellerId = await createStore()
    const { upload } = await api
      .clientAs(sellerOf(sellerId))
      .presignUpload(request({ sellerId, size: 1024 }))

    expect(upload.key).toMatch(new RegExp(`^products/${sellerId}/[0-9a-f-]{36}\\.png$`))
    expect(upload.publicUrl).toBe(`${testStorageConfig.publicBaseUrl}/${upload.key}`)
    expect(upload.method).toBe('PUT')
    expect(upload.headers).toEqual({ 'Content-Type': 'image/png' })
    expect(upload.contentLength).toBe(1024)
  })

  it('addresses the bucket path-style and signs the length and the type', async () => {
    const sellerId = await createStore()
    const { upload } = await api
      .clientAs(sellerOf(sellerId))
      .presignUpload(request({ sellerId, size: 1024 }))
    const url = new URL(upload.uploadUrl)

    expect(url.origin).toBe(testStorageConfig.endpoint)
    expect(url.pathname).toBe(`/${testStorageConfig.bucket}/${upload.key}`)
    expect(signedQuery(upload.uploadUrl).get('X-Amz-SignedHeaders')).toBe(
      'content-length;content-type;host',
    )
    expect(signedQuery(upload.uploadUrl).get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(signedQuery(upload.uploadUrl).get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('never repeats a key, so two requests cannot collide', async () => {
    // Also why gate A7 does not apply: concurrent calls produce two independent
    // keys, and that is the correct outcome rather than a race to avoid.
    const sellerId = await createStore()
    const client = api.clientAs(sellerOf(sellerId))
    const [first, second] = await Promise.all([
      client.presignUpload(request({ sellerId })),
      client.presignUpload(request({ sellerId })),
    ])

    expect(first.upload.key).not.toBe(second.upload.key)
  })

  it('takes the extension from the filename, lowercased', async () => {
    const sellerId = await createStore()
    const { upload } = await api
      .clientAs(sellerOf(sellerId))
      .presignUpload(request({ sellerId, filename: 'PHOTO.JPEG', contentType: 'image/jpeg' }))

    expect(upload.key.endsWith('.jpeg')).toBe(true)
  })

  it('answers a shape the shared schema accepts (C3)', async () => {
    // `createApiClient` already parsed it; asserting again states the intent of
    // the gate rather than relying on a reader noticing the client does it.
    const sellerId = await createStore()
    const response = await api.clientAs(sellerOf(sellerId)).presignUpload(request({ sellerId }))

    expect(presignUploadResponseSchema.safeParse(response).success).toBe(true)
  })
})

describe('the deadline comes from the injected clock (F8)', () => {
  it('dates the signature and the expiry at the instant the clock holds', async () => {
    const sellerId = await createStore()
    const { upload } = await api.clientAs(sellerOf(sellerId)).presignUpload(request({ sellerId }))

    expect(signedQuery(upload.uploadUrl).get('X-Amz-Date')).toBe('20260903T000000Z')
    expect(signedQuery(upload.uploadUrl).get('X-Amz-Expires')).toBe(String(UPLOAD_URL_TTL_SECONDS))
    expect(upload.expiresAt).toBe('2026-09-03T00:05:00.000Z')
  })

  it('moves with the clock, which is what proves it is not the system time', async () => {
    const sellerId = await createStore()

    api.clock.advance(3_600_000)
    const { upload } = await api.clientAs(sellerOf(sellerId)).presignUpload(request({ sellerId }))

    expect(signedQuery(upload.uploadUrl).get('X-Amz-Date')).toBe('20260903T010000Z')
    expect(upload.expiresAt).toBe('2026-09-03T01:05:00.000Z')

    api.clock.set('2026-09-03T00:00:00.000Z')
  })
})

describe('input validation (A2)', () => {
  async function refused(overrides: Partial<ProductImageRequest>): Promise<HttpFailure> {
    const sellerId = await createStore()
    const client = api.clientAs(sellerOf(sellerId))

    return failure(client.presignUpload(request({ sellerId, ...overrides })))
  }

  it.each([
    ['an executable', 'payload.exe', 'image/png'],
    ['an SVG, which is script in a browser', 'logo.svg', 'image/png'],
    ['a GIF', 'loop.gif', 'image/png'],
  ] as const)('refuses %s', async (_case, filename, contentType) => {
    const error = await refused({ filename, contentType })

    expect(error.status).toBe(400)
    expect(error.code).toBe('BAD_REQUEST')
    expect(error.details).toEqual([
      '지원하지 않는 확장자입니다. jpeg · jpg · png · webp 만 올릴 수 있습니다.',
    ])
  })

  it('refuses an extension that contradicts the declared type', async () => {
    const error = await refused({ filename: 'photo.png', contentType: 'image/jpeg' })

    expect(error.status).toBe(400)
    expect(error.details).toEqual(['확장자 .png 와(과) 형식 image/jpeg 이(가) 일치하지 않습니다.'])
  })

  it('refuses a name with no extension at all', async () => {
    const error = await refused({ filename: '사진' })

    expect(error.status).toBe(400)
    expect(error.details).toEqual(['파일 이름에 확장자가 없습니다. (jpeg · jpg · png · webp)'])
  })

  it('refuses a file over the cap (F5)', async () => {
    const error = await refused({ size: UPLOAD_MAX_BYTES + 1 })

    expect(error.status).toBe(400)
    expect(error.code).toBe('BAD_REQUEST')
    expect(error.details).toMatchObject([{ field: 'size', code: 'INVALID' }])
  })

  it.each([0, -1, 1.5])('refuses %s as a size', async (size) => {
    expect((await refused({ size })).status).toBe(400)
  })

  it.each([
    ['a path separator', '../../etc/passwd'],
    ['a Windows separator', 'C:\\photos\\a.png'],
  ] as const)('refuses a filename carrying %s', async (_case, filename) => {
    const error = await refused({ filename })

    expect(error.status).toBe(400)
    expect(error.details).toMatchObject([{ field: 'filename', code: 'INVALID' }])
  })

  it('refuses a filename that is only whitespace', async () => {
    // Two issues land on the same field here — too short *and* not matching the
    // shape — so the assertion is on the field being named, not on the count.
    const error = await refused({ filename: '   ' })

    expect(error.status).toBe(400)
    expect(error.details).toContainEqual(
      expect.objectContaining({ field: 'filename', code: 'INVALID' }),
    )
  })

  it('refuses a store id that is not a UUID', async () => {
    const error = await failure(
      api.clientAs(callers.superAdmin).presignUpload(request({ sellerId: 'store-1' })),
    )

    expect(error.status).toBe(400)
    expect(error.details).toMatchObject([{ field: 'sellerId', code: 'INVALID' }])
  })

  it('refuses a purpose nobody defined', async () => {
    const error = await failure(
      api.clientAs(callers.superAdmin).presignUpload({
        ...request(),
        purpose: 'avatar',
      } as unknown as PresignUploadRequest),
    )

    expect(error.status).toBe(400)
    expect(error.details).toMatchObject([{ field: 'purpose', code: 'INVALID' }])
  })

  it('reports every offending field at once, not just the first', async () => {
    const error = await failure(
      api
        .clientAs(callers.superAdmin)
        .presignUpload({ purpose: 'product-image' } as unknown as PresignUploadRequest),
    )

    expect(error.status).toBe(400)
    expect(error.details).toMatchObject([
      { field: 'sellerId' },
      { field: 'filename' },
      { field: 'contentType' },
      { field: 'size' },
    ])
  })
})

describe('authentication (A4)', () => {
  it('refuses a caller with no credentials', async () => {
    const error = await failure(api.client.presignUpload(request()))

    expect(error.status).toBe(401)
    expect(error.code).toBe('AUTH_REQUIRED')
  })
})

describe('authorisation (A3)', () => {
  it("refuses a buyer asking for a store's key", async () => {
    // A buyer now holds `media.upload:own` so that they can attach evidence to
    // a return (TASK-0067 F2), which makes the permission guard let them
    // through. What stops them here is the scope: a buyer owns no store, so
    // `own` cannot resolve against one and the refusal is `out_of_scope`
    // rather than a missing permission.
    const sellerId = await createStore()
    const error = await failure(api.clientAs(callers.buyer).presignUpload(request({ sellerId })))

    expect(error.status).toBe(403)
    expect(error.code).toBe('FORBIDDEN')
    expect(error.details).toEqual([deniedMessage('media.upload', 'out_of_scope')])
  })

  it("refuses a seller asking for another store's key", async () => {
    const mine = await createStore()
    const theirs = await createStore()
    const error = await failure(
      api.clientAs(sellerOf(mine)).presignUpload(request({ sellerId: theirs })),
    )

    expect(error.status).toBe(403)
    expect(error.details).toEqual([deniedMessage('media.upload', 'out_of_scope')])
  })

  it('lets an operator upload for any store', async () => {
    const sellerId = await createStore()
    const { upload } = await api.clientAs(callers.operator).presignUpload(request({ sellerId }))

    expect(upload.key.startsWith(`products/${sellerId}/`)).toBe(true)
  })

  it("refuses a demo administrator on a real seller's store", async () => {
    const sellerId = await createStore()
    const error = await failure(
      api.clientAs(callers.demoAdmin).presignUpload(request({ sellerId })),
    )

    expect(error.status).toBe(403)
    expect(error.details).toEqual([deniedMessage('media.upload', 'out_of_scope')])
  })

  it('lets a demo administrator upload for a store a demo account owns', async () => {
    const sellerId = await createStore({ demoOwner: true })
    const { upload } = await api.clientAs(callers.demoAdmin).presignUpload(request({ sellerId }))

    expect(upload.key.startsWith(`products/${sellerId}/`)).toBe(true)
  })

  it('answers 404 for a store that does not exist (A6 — the database decides)', async () => {
    const error = await failure(
      api
        .clientAs(callers.superAdmin)
        .presignUpload(request({ sellerId: '0192f0c1-0000-7000-8000-00000000dead' })),
    )

    expect(error.status).toBe(404)
    expect(error.details).toEqual(['스토어를 찾을 수 없습니다.'])
  })
})

/**
 * `purpose: 'return-photo'` (TASK-0067 F2).
 *
 * The whole point of the second purpose is that **the request names no owner**.
 * There is no field to put somebody else's id in, so every assertion below is
 * about the same sentence: the key carries the caller, and the caller is decided
 * by the token.
 *
 * These callers are rows rather than the fixed ids in `callers` because the
 * service reads the caller's own `User` — it has to, since `demo` is a property
 * of that row and no token carries it.
 */
describe('a photo for a return (F2)', () => {
  it("answers with a key under the caller's own id", async () => {
    const buyer = await accountAs(['BUYER'])
    const { upload } = await api.clientAs(buyer).presignUpload(photoRequest({ size: 1024 }))

    expect(upload.key).toMatch(new RegExp(`^returns/${buyer.userId}/[0-9a-f-]{36}\\.png$`))
    expect(upload.publicUrl).toBe(`${testStorageConfig.publicBaseUrl}/${upload.key}`)
    expect(upload.headers).toEqual({ 'Content-Type': 'image/png' })
    expect(upload.contentLength).toBe(1024)
  })

  it('never lands the object in a store prefix, even for a seller', async () => {
    // A seller who is also buying something files a return like anybody else,
    // and the key has to say so — their store is not the owner of this photo.
    const owner = await createUser(db, {})
    const store = await createSeller(db, { userId: owner.id })
    const seller: TestCaller = { userId: owner.id, roles: ['SELLER_OWNER'], sellerId: store.id }
    const { upload } = await api.clientAs(seller).presignUpload(photoRequest())

    expect(upload.key.startsWith(`returns/${owner.id}/`)).toBe(true)
    expect(upload.key).not.toContain(store.id)
  })

  it('gives an operator their own id too, because the request carries none', async () => {
    // `media.upload:any` widens which rows the operator may reach; it does not
    // add a field to the request, so the only owner available is themselves.
    const operator = await accountAs(['ADMIN_OPERATOR'])
    const { upload } = await api.clientAs(operator).presignUpload(photoRequest())

    expect(upload.key.startsWith(`returns/${operator.userId}/`)).toBe(true)
  })

  it('refuses a caller with no credentials', async () => {
    const error = await failure(api.client.presignUpload(photoRequest()))

    expect(error.status).toBe(401)
    expect(error.code).toBe('AUTH_REQUIRED')
  })

  it("refuses a demo administrator whose own account is not a visitor's", async () => {
    // `media.upload:demo` reaches rows a demo account created, and the row being
    // authorised here is the caller's own. A real account holding the role is
    // therefore out of scope of its own upload — which is the correct answer:
    // the demo console's administrator is not filing returns.
    const admin = await accountAs(['DEMO_ADMIN'])
    const error = await failure(api.clientAs(admin).presignUpload(photoRequest()))

    expect(error.status).toBe(403)
    expect(error.details).toEqual([deniedMessage('media.upload', 'out_of_scope')])
  })

  it('lets a demo administrator who is themselves a demo account through', async () => {
    const admin = await accountAs(['DEMO_ADMIN'], { isDemo: true })
    const { upload } = await api.clientAs(admin).presignUpload(photoRequest())

    expect(upload.key.startsWith(`returns/${admin.userId}/`)).toBe(true)
  })

  it('answers 404 when the account behind the token is gone', async () => {
    // `callers.demoAdmin` is an id with no row, which is what a token outliving
    // its account looks like. The answer is the same 404 a missing store gets:
    // the database decides who exists (A6).
    const error = await failure(api.clientAs(callers.demoAdmin).presignUpload(photoRequest()))

    expect(error.status).toBe(404)
    expect(error.details).toEqual(['계정을 찾을 수 없습니다.'])
  })

  it.each([
    ['an executable', 'payload.exe', 'image/png'],
    ['a mismatched extension', 'photo.png', 'image/jpeg'],
  ] as const)(
    'refuses %s exactly as it does for a product image (A2)',
    async (_case, filename, contentType) => {
      // The file rules know nothing about purpose — they are decided before an
      // owner is looked up at all, which is why one branch cannot drift from the
      // other.
      const buyer = await accountAs(['BUYER'])
      const error = await failure(
        api.clientAs(buyer).presignUpload(photoRequest({ filename, contentType })),
      )

      expect(error.status).toBe(400)
      expect(error.code).toBe('BAD_REQUEST')
    },
  )

  it('refuses a file over the cap (F5)', async () => {
    const buyer = await accountAs(['BUYER'])
    const error = await failure(
      api.clientAs(buyer).presignUpload(photoRequest({ size: UPLOAD_MAX_BYTES + 1 })),
    )

    expect(error.status).toBe(400)
    expect(error.details).toMatchObject([{ field: 'size', code: 'INVALID' }])
  })

  it('has nowhere to put somebody else, so a smuggled owner changes nothing', async () => {
    // The return branch of the union declares no owner, so a `sellerId` in the
    // body is dropped at the parse and never reaches a lookup. That is the
    // property worth stating: the absent field is why no check has to exist for
    // it (TASK-0067 F2).
    const buyer = await accountAs(['BUYER'])
    const store = await createStore()
    const { upload } = await api.clientAs(buyer).presignUpload({
      ...photoRequest(),
      sellerId: store,
    } as unknown as PresignUploadRequest)

    expect(upload.key.startsWith(`returns/${buyer.userId}/`)).toBe(true)
  })

  it('answers a shape the shared schema accepts (C3)', async () => {
    const buyer = await accountAs(['BUYER'])
    const response = await api.clientAs(buyer).presignUpload(photoRequest())

    expect(presignUploadResponseSchema.safeParse(response).success).toBe(true)
  })
})

describe('before the storage account exists (F11)', () => {
  const unconfigured = useApiApp({ database: db, authenticate: true, config: { storage: null } })

  it('answers 503 rather than failing somewhere deeper', async () => {
    const sellerId = await createStore()
    const client: ApiClient = unconfigured.clientAs(sellerOf(sellerId))
    const error = await failure(client.presignUpload(request({ sellerId })))

    expect(error.status).toBe(503)
    expect(error.code).toBe('SERVICE_UNAVAILABLE')
    expect(error.details).toEqual(['이미지 저장소가 설정되지 않아 업로드를 사용할 수 없습니다.'])
  })

  it('still refuses an unauthorised caller first', async () => {
    // A missing bucket must not become a way to find out what a role may do.
    // The store has to exist for that to be what the answer is about — a made-up
    // id answers 404 before anything is authorised, which would leave this
    // assertion true for the wrong reason.
    const sellerId = await createStore()
    const error = await failure(
      unconfigured.clientAs(callers.buyer).presignUpload(request({ sellerId })),
    )

    expect(error.status).toBe(403)
  })
})
