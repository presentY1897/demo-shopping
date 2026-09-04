/**
 * What the `/me` double promises the screens that build on it (TASK-0112).
 *
 * The address book is the second stateful endpoint set in this package, and the
 * rules it keeps are not decoration: `apps/shop`'s specs assert that a badge
 * moved and that deleting the default promoted a specific survivor, and those
 * assertions are only worth as much as the rules below. A double that promoted
 * the *oldest* address would make the screen spec pass against an API that does
 * the opposite.
 *
 * Every call goes through `createApiClient`, the client the app itself uses, so
 * a body that drifted from the shared schema fails here as `malformed_response`
 * rather than reaching a screen that renders it (C1 · C2).
 */

import type {
  AddressListResponse,
  AddressResponse,
  ProfileResponse,
  UserPreferenceResponse,
  WithdrawalResponse,
} from '@shopping/shared'
import {
  addressListResponseSchema,
  addressResponseSchema,
  createApiClient,
  DEFAULT_USER_PREFERENCE,
  isApiClientError,
  profileResponseSchema,
  userPreferenceResponseSchema,
  withdrawalResponseSchema,
} from '@shopping/shared'
import { beforeEach, describe, expect, it } from 'vitest'

import { addressBook, addressHome, addressOffice, profileBuyer } from './fixtures/profile'
import { sessionBuyer } from './fixtures/session'
import {
  addressRowsSnapshot,
  failNextDefaultAssignment,
  preferenceSnapshot,
  resetProfileStore,
} from './handlers'
import { setupTestServer } from './node'

setupTestServer()

const client = createApiClient({ appId: 'shop', baseUrl: 'http://api.test.invalid' })

const me = (): Promise<ProfileResponse> =>
  client.request({ path: '/me', schema: profileResponseSchema })

const list = (): Promise<AddressListResponse> =>
  client.request({ path: '/me/addresses', schema: addressListResponseSchema })

const makeDefault = (id: string): Promise<AddressResponse> =>
  client.request({
    path: `/me/addresses/${id}/default`,
    method: 'POST',
    schema: addressResponseSchema,
  })

const remove = (id: string): Promise<AddressResponse> =>
  client.request({ path: `/me/addresses/${id}`, method: 'DELETE', schema: addressResponseSchema })

const create = (label: string, isDefault = false): Promise<AddressResponse> =>
  client.request({
    path: '/me/addresses',
    method: 'POST',
    body: {
      label,
      recipientName: '박지후',
      phone: '010-1111-2222',
      postalCode: '04524',
      addressLine1: '서울특별시 중구 세종대로 110',
      isDefault,
    },
    schema: addressResponseSchema,
  })

/** The status a failed call came back with, or `null` if it succeeded. */
async function statusOf(call: Promise<unknown>): Promise<number | null> {
  return call.then(
    () => null,
    (error: unknown) => (isApiClientError(error) ? (error.status ?? -1) : -1),
  )
}

describe('the profile fixture', () => {
  it('belongs to the shopper every shop spec signs in as', () => {
    // `/me` names no account, so the only thing tying the answer to the caller
    // is that the double and the session agree on who that is.
    expect(profileBuyer.profile.id).toBe(sessionBuyer.user.id)
    expect(profileBuyer.profile.roles).toEqual(sessionBuyer.user.roles)
  })

  it('starts from the settings an account that never saved one is given', () => {
    expect(profileBuyer.preference).toEqual(DEFAULT_USER_PREFERENCE)
  })

  it('holds three addresses with exactly one default', () => {
    expect(addressBook.items).toHaveLength(3)
    expect(addressBook.items.filter((row) => row.isDefault)).toHaveLength(1)
  })
})

describe('the address book', () => {
  it('is answered default first, then newest', async () => {
    const { items } = await list()

    expect(items.map((row) => row.label)).toEqual(['집', '회사', null])
  })
})

describe('editing the profile', () => {
  it('is reflected in the next read', async () => {
    await client.request({
      path: '/me',
      method: 'PATCH',
      body: { name: '김민서' },
      schema: profileResponseSchema,
    })

    await expect(me().then(({ profile }) => profile.name)).resolves.toBe('김민서')
  })

  it('tells a cleared picture from an omitted one', async () => {
    await client.request({
      path: '/me',
      method: 'PATCH',
      body: { avatarUrl: null },
      schema: profileResponseSchema,
    })
    // A second write that says nothing about the picture must not restore it.
    await client.request({
      path: '/me',
      method: 'PATCH',
      body: { name: '김민준' },
      schema: profileResponseSchema,
    })

    await expect(me().then(({ profile }) => profile.avatarUrl)).resolves.toBeNull()
  })

  it('refuses a name the shared schema rejects', async () => {
    await expect(
      statusOf(
        client.request({
          path: '/me',
          method: 'PATCH',
          body: { name: '   ' },
          schema: profileResponseSchema,
        }),
      ),
    ).resolves.toBe(400)
  })
})

describe('settings', () => {
  it('keeps the fields a partial update did not mention', async () => {
    await client.request({
      path: '/me/preferences',
      method: 'PATCH',
      body: { density: 'MAXIMAL' },
      schema: userPreferenceResponseSchema,
    })

    const { preference }: UserPreferenceResponse = await client.request({
      path: '/me/preferences',
      schema: userPreferenceResponseSchema,
    })

    expect(preference.density).toBe('MAXIMAL')
    expect(preference.notifyOrder).toBe(DEFAULT_USER_PREFERENCE.notifyOrder)
    expect(preferenceSnapshot().density).toBe('MAXIMAL')
  })

  it('refuses a density that is not one of the three', async () => {
    await expect(
      statusOf(
        client.request({
          path: '/me/preferences',
          method: 'PATCH',
          body: { density: 'COMPACT' },
          schema: userPreferenceResponseSchema,
        }),
      ),
    ).resolves.toBe(400)
  })
})

describe('the one-default rule', () => {
  it('makes the first address the default whatever the request says', async () => {
    resetProfileStore([])

    const { address } = await create('집', false)

    expect(address.isDefault).toBe(true)
  })

  it('moves the default rather than adding a second one', async () => {
    const { address } = await makeDefault(addressOffice.id)

    expect(address.isDefault).toBe(true)
    expect(addressRowsSnapshot().filter((row) => row.isDefault)).toHaveLength(1)
    expect(addressRowsSnapshot()[0]?.id).toBe(addressOffice.id)
  })

  it('writes nothing when the address is already the default', async () => {
    const before = addressRowsSnapshot()
    const { address } = await makeDefault(addressHome.id)

    expect(address).toEqual(addressHome)
    expect(addressRowsSnapshot()).toEqual(before)
  })

  it('promotes the newest survivor when the default is deleted', async () => {
    const { address } = await remove(addressHome.id)

    // The row that left is answered without the flag: it is not the default of
    // anything any more, and a screen that re-rendered it would show two.
    expect(address.isDefault).toBe(false)
    // `회사` was created after `부모님`, so it is the newest of the two left.
    expect(addressRowsSnapshot()[0]?.id).toBe(addressOffice.id)
    expect(addressRowsSnapshot()[0]?.isDefault).toBe(true)
  })

  it('leaves no default when the last address is deleted', async () => {
    resetProfileStore([addressHome])

    await remove(addressHome.id)

    expect(addressRowsSnapshot()).toEqual([])
  })

  it('sorts a newly created address ahead of every seeded one', async () => {
    const { address } = await create('기숙사')
    const { items } = await list()

    // Default first, then newest: the new row is second, behind `집`.
    expect(items[1]?.id).toBe(address.id)
  })
})

describe('the losing side of a concurrent default assignment', () => {
  beforeEach(() => {
    failNextDefaultAssignment()
  })

  it('is a 409, not a silent overwrite', async () => {
    expect(await statusOf(makeDefault(addressOffice.id))).toBe(409)
    // The winner's choice stands. Retrying the loser's intent would overwrite
    // it in a race the person cannot see (TASK-0111 4장).
    expect(addressRowsSnapshot()[0]?.id).toBe(addressHome.id)
  })

  it('is one-shot, so the recovery half can be tested', async () => {
    await statusOf(makeDefault(addressOffice.id))

    await expect(
      makeDefault(addressOffice.id).then(({ address }) => address.isDefault),
    ).resolves.toBe(true)
  })
})

describe('withdrawal', () => {
  it('reports what it erased', async () => {
    const answer: WithdrawalResponse = await client.request({
      path: '/me',
      method: 'DELETE',
      schema: withdrawalResponseSchema,
    })

    expect(answer.userId).toBe(profileBuyer.profile.id)
    expect(answer.deletedAddresses).toBe(3)
    expect(answer.revokedSessions).toBeGreaterThan(0)
  })

  it('answers 404 to everything afterwards, including a second attempt', async () => {
    await client.request({ path: '/me', method: 'DELETE', schema: withdrawalResponseSchema })

    expect(await statusOf(me())).toBe(404)
    expect(await statusOf(list())).toBe(404)
    expect(
      await statusOf(
        client.request({ path: '/me', method: 'DELETE', schema: withdrawalResponseSchema }),
      ),
    ).toBe(404)
  })
})

describe('an address that is not there', () => {
  it('is a 404 rather than an empty answer', async () => {
    expect(await statusOf(remove('019596d0-2a10-7c2e-9a0e-0000000000ff'))).toBe(404)
  })
})
