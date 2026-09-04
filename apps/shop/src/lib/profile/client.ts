import type {
  Address,
  AddressCreateRequest,
  AddressUpdateRequest,
  ApiCallOptions,
  ProfileResponse,
  ProfileUpdateRequest,
  UserPreference,
  UserPreferenceUpdateRequest,
  WithdrawalResponse,
} from '@shopping/shared'
import {
  addressListResponseSchema,
  addressResponseSchema,
  profileResponseSchema,
  userPreferenceResponseSchema,
  withdrawalResponseSchema,
} from '@shopping/shared'

import { getApiClient } from '@/lib/api'

/**
 * The ten `/me` endpoints, named once each (TASK-0111 4장).
 *
 * **`createApiClient` has no methods for them.** TASK-0111 defined the schemas
 * in `packages/shared` and stopped there, and that package is not this task's to
 * extend — a front-end that invented endpoints the API does not serve would be
 * dead code that its own mocks make green (CLAUDE.md 2장). So the calls go
 * through `ApiClient.request`, which is the seam the shared client already
 * offers, with the shared schema handed to each one.
 *
 * **Gate C1 holds either way.** The rule is that a response type is not
 * redefined outside `packages/shared`; every schema below is imported from
 * there and nothing in `apps/shop` describes a `/me` payload. What a method per
 * endpoint would buy is that the schema is named *once* — and that is what this
 * file is: no screen calls `request` itself, so there is still exactly one place
 * where a path and a schema meet.
 *
 * When `packages/shared` grows the methods, this file becomes ten forwarding
 * calls and then nothing. That is a deletion, not a migration.
 */

/** Profile **and** settings — one round trip, because one screen shows both. */
export function fetchProfile(options?: ApiCallOptions): Promise<ProfileResponse> {
  return getApiClient().request({ path: '/me', schema: profileResponseSchema, ...options })
}

export function saveProfile(
  body: ProfileUpdateRequest,
  options?: ApiCallOptions,
): Promise<ProfileResponse> {
  return getApiClient().request({
    path: '/me',
    method: 'PATCH',
    body,
    schema: profileResponseSchema,
    ...options,
  })
}

export function fetchPreference(options?: ApiCallOptions): Promise<UserPreference> {
  return getApiClient()
    .request({ path: '/me/preferences', schema: userPreferenceResponseSchema, ...options })
    .then(({ preference }) => preference)
}

/**
 * Saves settings, and is also the density promotion (`pages.md` — 밀도 승격).
 *
 * The server does not distinguish "a signed-out visitor's stored choice is
 * being lifted onto the account" from "the person moved the toggle"; telling
 * them apart would mean trusting a flag the client sent, and the answer would be
 * the same either way — last write wins. *When* to promote is this app's
 * judgement, and it lives in `density-preference.ts`.
 */
export function savePreference(
  body: UserPreferenceUpdateRequest,
  options?: ApiCallOptions,
): Promise<UserPreference> {
  return getApiClient()
    .request({
      path: '/me/preferences',
      method: 'PATCH',
      body,
      schema: userPreferenceResponseSchema,
      ...options,
    })
    .then(({ preference }) => preference)
}

/** Default first, then newest. The order is the answer's, not the screen's. */
export function fetchAddresses(options?: ApiCallOptions): Promise<readonly Address[]> {
  return getApiClient()
    .request({ path: '/me/addresses', schema: addressListResponseSchema, ...options })
    .then(({ items }) => items)
}

export function createAddress(
  body: AddressCreateRequest,
  options?: ApiCallOptions,
): Promise<Address> {
  return getApiClient()
    .request({
      path: '/me/addresses',
      method: 'POST',
      body,
      schema: addressResponseSchema,
      ...options,
    })
    .then(({ address }) => address)
}

export function updateAddress(
  id: string,
  body: AddressUpdateRequest,
  options?: ApiCallOptions,
): Promise<Address> {
  return getApiClient()
    .request({
      path: `/me/addresses/${id}`,
      method: 'PATCH',
      body,
      schema: addressResponseSchema,
      ...options,
    })
    .then(({ address }) => address)
}

/** Answers the row it removed, so the screen need not ask what it just lost. */
export function deleteAddress(id: string, options?: ApiCallOptions): Promise<Address> {
  return getApiClient()
    .request({
      path: `/me/addresses/${id}`,
      method: 'DELETE',
      schema: addressResponseSchema,
      ...options,
    })
    .then(({ address }) => address)
}

/**
 * The only door to changing which address is the default.
 *
 * `isDefault` is absent from `addressUpdateRequestSchema` on purpose: promotion
 * clears the previous default in the same transaction, and a second entrance
 * could not hold that. Two people choosing different defaults at once means one
 * of them gets a 409 — the index refuses it and the API does not retry, because
 * retrying would overwrite the choice that won in a race neither can see.
 */
export function makeAddressDefault(id: string, options?: ApiCallOptions): Promise<Address> {
  return getApiClient()
    .request({
      path: `/me/addresses/${id}/default`,
      method: 'POST',
      schema: addressResponseSchema,
      ...options,
    })
    .then(({ address }) => address)
}

/**
 * Withdrawal. Irreversible, and answered with counts rather than a bare 204 so
 * the screen can say what actually happened.
 */
export function withdraw(options?: ApiCallOptions): Promise<WithdrawalResponse> {
  return getApiClient().request({
    path: '/me',
    method: 'DELETE',
    schema: withdrawalResponseSchema,
    ...options,
  })
}
