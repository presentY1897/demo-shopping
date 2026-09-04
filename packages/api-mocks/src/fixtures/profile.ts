import type { Address, ProfileResponse } from '@shopping/shared'
import {
  addressListResponseSchema,
  addressSchema,
  DEFAULT_USER_PREFERENCE,
  profileResponseSchema,
  userPreferenceResponseSchema,
  withdrawalResponseSchema,
} from '@shopping/shared'

import { defineFixture } from '../define'

/**
 * The `/me` family, as `apps/api` answers it (TASK-0111) and `apps/shop`'s
 * account screens read it (TASK-0112).
 *
 * **The account id is `sessionBuyer`'s.** `/me` names no user, so a screen
 * cannot ask for anybody else — but a spec that signs in as the shopper and
 * then reads a profile belonging to a different id would be showing one
 * person's session beside another's data, which is a state the real API cannot
 * produce. Not imported from `fixtures/session.ts`: `registry.spec.ts` requires
 * every export of a fixture file to be a fixture, so the constant is restated
 * here and `profile-mock.spec.ts` fails if the two ever disagree.
 */
const USER_ID = '019596d0-1f1c-7c2e-9a0e-4a5a3a2f0001'

/**
 * Address ids, in creation order.
 *
 * **UUIDv7, and the ordering is load bearing.** The default-address promotion
 * rule is "`createdAt` 내림차순, 동률이면 `id` 내림차순" (TASK-0111 4장), and
 * `addressSchema` carries no `createdAt` — an address is what the screen sees,
 * and the screen has no reason to see a timestamp. A v7 id already encodes the
 * instant it was minted, which is exactly why that rule names `id` as its tie
 * breaker, so the double resolves the promotion by id alone and stays
 * decidable. `handlers/profile.ts` mints new ids on the same prefix so a row
 * created during a test sorts after every seed — it reads the prefix off a
 * seeded row rather than restating it, because `registry.spec.ts` requires
 * every export of this file to be a fixture and a second copy of a constant is
 * a second thing to keep in step.
 */
const ADDRESS_ID_PREFIX = '019596d0-2a10-7c2e-9a0e-'

function addressId(sequence: number): string {
  return `${ADDRESS_ID_PREFIX}${sequence.toString(16).padStart(12, '0')}`
}

function address(sequence: number, values: Omit<Address, 'id'>): Address {
  return defineFixture(addressSchema, { id: addressId(sequence), ...values })
}

/**
 * The shopper whose account every `apps/shop` account spec reads.
 *
 * `avatarUrl` is set rather than `null` so the settings form has something to
 * clear — "removing the picture" is a separate path from "changing the name"
 * and an all-null fixture would leave it untested. `roles` is `BUYER` alone:
 * `profile.write` and `profile.delete` are granted to that role on `own`
 * scope, so this account can reach every control the screens draw.
 */
export const profileBuyer: ProfileResponse = defineFixture(profileResponseSchema, {
  profile: {
    id: USER_ID,
    email: 'buyer@demo-shopping.test',
    name: '김민준',
    avatarUrl: 'https://cdn.test.invalid/avatars/buyer.png',
    roles: ['BUYER'],
  },
  preference: DEFAULT_USER_PREFERENCE,
})

/** The settings row as an account that has never saved one is answered. */
export const preferenceDefault = defineFixture(userPreferenceResponseSchema, {
  preference: DEFAULT_USER_PREFERENCE,
})

/**
 * Three saved addresses, one of them the default (TASK-0112 F2).
 *
 * Three rather than one, because every rule this screen renders needs a
 * neighbour to be visible: the badge has to be *somewhere* rather than
 * everywhere, "기본으로" has to have a target that is not already the default,
 * and deleting the default has to promote a specific one of the two survivors
 * — the newest, which is `label: '회사'` below.
 *
 * `label` is null on one of them: it is the only nullable field a person fills
 * in, and a card that assumed a name would break on the first address somebody
 * saved without one.
 */
export const addressHome: Address = address(1, {
  label: '집',
  recipientName: '김민준',
  phone: '010-2345-6789',
  postalCode: '06236',
  addressLine1: '서울특별시 강남구 테헤란로 152',
  addressLine2: '11층 1103호',
  isDefault: true,
})

export const addressParents: Address = address(2, {
  label: null,
  recipientName: '김서연',
  // A landline, which `phoneSchema` admits on purpose: the recipient of a
  // parcel is not always the buyer.
  phone: '02-123-4567',
  postalCode: '48058',
  addressLine1: '부산광역시 해운대구 해운대해변로 264',
  addressLine2: null,
  isDefault: false,
})

export const addressOffice: Address = address(3, {
  label: '회사',
  recipientName: '김민준',
  phone: '010-2345-6789',
  postalCode: '13529',
  addressLine1: '경기도 성남시 분당구 판교역로 235',
  addressLine2: 'C동 3층',
  isDefault: false,
})

/**
 * The address book as the API orders it — default first, then newest.
 *
 * The order is a property of the answer, not of each screen that renders it
 * (`addressListResponseSchema`), so the double seeds it already sorted and
 * `handlers/profile.ts` re-sorts every answer the same way.
 */
export const addressBook = defineFixture(addressListResponseSchema, {
  items: [addressHome, addressOffice, addressParents],
})

/** An account that has saved nothing yet — the empty state of the list. */
export const addressBookEmpty = defineFixture(addressListResponseSchema, { items: [] })

/**
 * What `DELETE /me` answers.
 *
 * Counts rather than a bare 204, so the screen that confirms an irreversible
 * action can say what actually happened instead of guessing (TASK-0111 4장).
 * The three addresses above are the three this reports erasing.
 */
export const withdrawalDone = defineFixture(withdrawalResponseSchema, {
  userId: USER_ID,
  deletedAt: '2026-09-04T02:15:30.000Z',
  deletedAddresses: 3,
  revokedSessions: 2,
})
