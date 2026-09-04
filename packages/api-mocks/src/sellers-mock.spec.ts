/**
 * What the seller double promises the screens that build on it.
 *
 * TASK-0109 renders five faces of one store and asks the API which one to draw,
 * so the console's specs are only as trustworthy as the refusals below: a double
 * that let a stale `version` through, or that answered a taken brand name with
 * 200, would make the conflict and duplicate specs pass while the screen did
 * nothing.
 *
 * Every call goes through `createApiClient` — the client the app uses — with the
 * shared schema, so a response that drifted from `sellerSchema` fails here as
 * `malformed_response` instead of reaching a screen that renders it (C1·C2).
 */

import type { Seller } from '@shopping/shared'
import {
  createApiClient,
  isApiClientError,
  isApiFieldError,
  sellerResponseSchema,
  brandNameAvailabilityResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { brandNameTaken, sellerActive, sellerPending, sellerRejected } from './fixtures/sellers'
import { resetSellerStore, sellerRequests } from './handlers/sellers'
import { setupTestServer } from './node'

setupTestServer()

const client = createApiClient({ appId: 'seller', baseUrl: 'http://api.test.invalid' })

const APPLICATION = {
  brandName: '해뜰녘',
  slug: 'haetteulnyeok',
  introduction: '아침 햇살 색으로 물들인 리넨.',
} as const

function ownStore() {
  return client.request({ path: '/sellers/me', schema: sellerResponseSchema })
}

function apply(body: unknown) {
  return client.request({
    path: '/sellers/applications',
    schema: sellerResponseSchema,
    method: 'POST',
    body,
  })
}

function save(body: unknown) {
  return client.request({
    path: '/sellers/me',
    schema: sellerResponseSchema,
    method: 'PATCH',
    body,
  })
}

/** The failure a call came back with, or `null` if it succeeded. */
async function refusalOf(
  call: Promise<unknown>,
): Promise<{ status: number; fields: readonly string[] } | null> {
  return call.then(
    () => null,
    (error: unknown) => {
      if (!isApiClientError(error)) throw error

      return {
        status: error.status ?? -1,
        fields: (error.body?.error.details ?? [])
          .filter(isApiFieldError)
          .map((entry) => entry.field),
      }
    },
  )
}

describe('an account that has never applied', () => {
  it('is a 404, not an empty payload', async () => {
    // The whole reason the console's state model has an `absent` branch.
    expect(await refusalOf(ownStore())).toEqual({ status: 404, fields: [] })
  })

  it('gets a PENDING store when it applies', async () => {
    const { seller } = await apply(APPLICATION)

    expect(seller.status).toBe('PENDING')
    expect(seller.statusReason).toBeNull()
    expect(seller.version).toBe(0)
    await expect(ownStore()).resolves.toMatchObject({ seller: { brandName: '해뜰녘' } })
  })
})

describe('a rejected store', () => {
  beforeEach(() => {
    resetSellerStore(sellerRejected)
  })

  it('answers with the reason a person wrote', async () => {
    const { seller } = await ownStore()

    expect(seller.status).toBe('REJECTED')
    expect(seller.statusReason).toBe(sellerRejected.statusReason)
  })

  it('goes back to PENDING on a re-application, and the reason is cleared', async () => {
    const { seller } = await apply({ ...APPLICATION, brandName: '해뜰녘' })

    expect(seller.status).toBe('PENDING')
    expect(seller.statusReason).toBeNull()
    // Same row: an account owns at most one store.
    expect(seller.id).toBe(sellerRejected.id)
    expect(seller.version).toBe(sellerRejected.version + 1)
  })
})

describe('applying from a state that cannot apply', () => {
  it.each([
    ['PENDING', sellerPending],
    ['ACTIVE', sellerActive],
  ])('is refused with a 400 naming status (%s)', async (_label, seed: Seller) => {
    resetSellerStore(seed)

    expect(await refusalOf(apply(APPLICATION))).toEqual({ status: 400, fields: ['status'] })
  })
})

describe('saving the store', () => {
  beforeEach(() => {
    resetSellerStore(sellerActive)
  })

  it('raises the version and keeps everything not sent', async () => {
    const { seller } = await save({ brandName: '해뜰녘', version: sellerActive.version })

    expect(seller).toMatchObject({
      brandName: '해뜰녘',
      slug: sellerActive.slug,
      introduction: sellerActive.introduction,
      version: sellerActive.version + 1,
    })
  })

  it('refuses a stale version with a 409 naming version', async () => {
    await save({ introduction: '먼저 저장한 쪽.', version: sellerActive.version })

    expect(
      await refusalOf(save({ introduction: '늦은 쪽.', version: sellerActive.version })),
    ).toEqual({ status: 409, fields: ['version'] })
  })

  it('does not let the loser of that race overwrite the winner', async () => {
    await save({ introduction: '먼저 저장한 쪽.', version: sellerActive.version })
    await refusalOf(save({ introduction: '늦은 쪽.', version: sellerActive.version }))

    await expect(ownStore()).resolves.toMatchObject({
      seller: { introduction: '먼저 저장한 쪽.' },
    })
  })

  it('refuses a brand name another account holds, on the field that carries it', async () => {
    expect(
      await refusalOf(save({ brandName: brandNameTaken.value, version: sellerActive.version })),
    ).toEqual({ status: 409, fields: ['brandName'] })
  })

  it('checks the version before the name, as the real statement does', async () => {
    // The `WHERE version = ?` guard means a stale editor never reaches the
    // unique index, so a request that is wrong about both is told about the
    // version — the one it can act on by reloading.
    expect(
      await refusalOf(save({ brandName: brandNameTaken.value, version: sellerActive.version + 9 })),
    ).toEqual({ status: 409, fields: ['version'] })
  })
})

describe('the brand name check', () => {
  it('is free for a name nobody holds and taken for one somebody does', async () => {
    const query = (value: string) =>
      client.request({
        path: `/sellers/brand-name-availability?value=${encodeURIComponent(value)}`,
        schema: brandNameAvailabilityResponseSchema,
      })

    await expect(query('해뜰녘')).resolves.toEqual({ value: '해뜰녘', available: true })
    await expect(query(brandNameTaken.value)).resolves.toEqual({
      value: brandNameTaken.value,
      available: false,
    })
  })

  it('is never the decision — the same name is still refused on submit', async () => {
    const { available } = await client.request({
      path: `/sellers/brand-name-availability?value=${encodeURIComponent(brandNameTaken.value)}`,
      schema: brandNameAvailabilityResponseSchema,
    })
    expect(available).toBe(false)

    expect(await refusalOf(apply({ ...APPLICATION, brandName: brandNameTaken.value }))).toEqual({
      status: 409,
      fields: ['brandName'],
    })
  })
})

describe('the request log', () => {
  it('records what a screen actually sent', async () => {
    resetSellerStore(sellerActive)
    await save({ brandName: '해뜰녘', version: sellerActive.version })

    expect(sellerRequests()).toEqual([
      { method: 'PATCH', path: '/sellers/me', body: { brandName: '해뜰녘', version: 3 } },
    ])
  })
})
