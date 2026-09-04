import type {
  Address,
  AddressCreateRequest,
  AddressUpdateRequest,
  Profile,
  ProfileUpdateRequest,
  UserPreference,
  UserPreferenceUpdateRequest,
} from '@shopping/shared'
import {
  addressCreateRequestSchema,
  addressListResponseSchema,
  addressResponseSchema,
  addressUpdateRequestSchema,
  profileResponseSchema,
  profileUpdateRequestSchema,
  userPreferenceResponseSchema,
  userPreferenceUpdateRequestSchema,
  withdrawalResponseSchema,
} from '@shopping/shared'
import type { PathParams, RequestHandler } from 'msw'
import { http, HttpResponse } from 'msw'

import { defineFixture } from '../define'
import { addressBook, profileBuyer, withdrawalDone } from '../fixtures/profile'
import { mockPaths } from '../paths'
import { answering, MockApiError, readBody } from './refusal'

/**
 * One's own profile, settings and address book (TASK-0111's `/me` family).
 *
 * **Stateful, like the category endpoints and unlike everything else here.**
 * The screens this serves (TASK-0112) do not ask "what does the API
 * volunteer"; they ask what it *does* with a request — whether the badge moves
 * when another address is made the default, which address is promoted when the
 * default is deleted, whether a name that was saved comes back on the next
 * read. A frozen fixture cannot answer any of those, and a `server.use` in each
 * spec would put a different half-API in every file.
 *
 * **What is reproduced, and what is deliberately not.** The three rules that
 * make "기본 배송지가 항상 정확히 1개" true are here, because they are what the
 * screen renders:
 *
 * | 순간 | 규칙 |
 * | --- | --- |
 * | 생성 | 첫 배송지는 요청과 무관하게 기본이 된다 |
 * | 지정 | 이미 기본이면 아무것도 쓰지 않고 현재 값을 돌려준다 (멱등) |
 * | 삭제 | 기본을 지우면 가장 최근에 만든 것이 승격한다 |
 *
 * The *enforcement* is not: the real invariant is a partial unique index and a
 * transaction, and reproducing those in a mock would be a second, weaker
 * implementation of something `apps/api`'s own tests already run against a real
 * PostgreSQL (QUALITY-GATES 6장). What a browser can observe of that index is
 * the **409 the loser gets**, and that is available here through
 * {@link failNextDefaultAssignment} — a race cannot be staged in a single
 * process, so the double is told to produce the answer rather than asked to
 * lose a race it cannot have.
 *
 * Every body goes through `defineFixture`, so a payload that drifted from the
 * contract fails here rather than in the screen it misleads (gate C2).
 */

/** Ordered as the API orders it: the default first, then newest to oldest. */
function ordered(rows: readonly Address[]): Address[] {
  return [...rows].sort((left, right) => {
    if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1

    // Descending by id **is** descending by creation time: the ids are UUIDv7.
    return right.id.localeCompare(left.id)
  })
}

class ProfileStore {
  private profile!: Profile
  private preference!: UserPreference
  private rows!: Address[]
  private nextSequence!: number
  private withdrawnAt: string | null = null

  constructor() {
    this.reset()
  }

  reset(seed: readonly Address[] = addressBook.items): void {
    this.profile = { ...profileBuyer.profile, roles: [...profileBuyer.profile.roles] }
    this.preference = { ...profileBuyer.preference }
    this.rows = seed.map((row) => ({ ...row }))
    this.withdrawnAt = null

    // Ids are never reused, so the counter starts past every id ever issued.
    this.nextSequence =
      this.rows.reduce((highest, row) => Math.max(highest, sequenceOf(row.id)), 0) + 1
  }

  /** What the double holds right now, so a spec can assert without a round trip. */
  snapshot(): readonly Address[] {
    return ordered(this.rows)
  }

  currentPreference(): UserPreference {
    return this.preference
  }

  readProfile(): { profile: Profile; preference: UserPreference } {
    this.refuseWithdrawn()

    return { profile: this.profile, preference: this.preference }
  }

  updateProfile(input: ProfileUpdateRequest): { profile: Profile; preference: UserPreference } {
    this.refuseWithdrawn()
    this.profile = {
      ...this.profile,
      name: input.name ?? this.profile.name,
      // `null` clears the picture and `undefined` leaves it: the schema admits
      // both and they mean different things, so `??` alone would lose the
      // clear.
      avatarUrl: input.avatarUrl === undefined ? this.profile.avatarUrl : input.avatarUrl,
    }

    return { profile: this.profile, preference: this.preference }
  }

  updatePreference(input: UserPreferenceUpdateRequest): UserPreference {
    this.refuseWithdrawn()
    this.preference = { ...this.preference, ...definedOnly(input) }

    return this.preference
  }

  list(): readonly Address[] {
    this.refuseWithdrawn()

    return ordered(this.rows)
  }

  create(input: AddressCreateRequest): Address {
    this.refuseWithdrawn()

    // The first address is the default whatever the request says: "배송지는
    // 있는데 기본이 없는" 상태를 만들지 않는다 (TASK-0111 4장).
    const isDefault = this.rows.length === 0 || input.isDefault === true
    if (isDefault) this.clearDefault()

    const created: Address = {
      id: this.mintId(),
      label: input.label ?? null,
      recipientName: input.recipientName,
      phone: input.phone,
      postalCode: input.postalCode,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2 ?? null,
      isDefault,
    }
    this.rows.push(created)

    return created
  }

  update(id: string, input: AddressUpdateRequest): Address {
    const row = this.mustExist(id)
    // `isDefault` is absent from the update schema on purpose — promotion is
    // its own endpoint, which clears the previous default in a transaction.
    const updated: Address = { ...row, ...definedOnly(input) }
    this.replace(updated)

    return updated
  }

  remove(id: string): Address {
    const row = this.mustExist(id)
    this.rows = this.rows.filter((candidate) => candidate.id !== id)

    // Deleting the default promotes the newest survivor. Nothing left means no
    // default, which is the one state without one that the contract allows.
    if (row.isDefault) {
      const heir = ordered(this.rows)[0]
      if (heir !== undefined) this.replace({ ...heir, isDefault: true })
    }

    return { ...row, isDefault: false }
  }

  makeDefault(id: string): Address {
    const row = this.mustExist(id)

    // Idempotent: a double-clicked button must not look like an index
    // violation.
    if (row.isDefault) return row

    if (failNextDefault) {
      failNextDefault = false
      throw new MockApiError(
        409,
        '기본 배송지가 방금 다른 곳에서 바뀌었어요. 목록을 새로고침해 주세요.',
      )
    }

    this.clearDefault()
    const promoted: Address = { ...row, isDefault: true }
    this.replace(promoted)

    return promoted
  }

  withdraw(): {
    userId: string
    deletedAt: string
    deletedAddresses: number
    revokedSessions: number
  } {
    this.refuseWithdrawn()

    const deletedAddresses = this.rows.length
    this.rows = []
    this.withdrawnAt = withdrawalDone.deletedAt

    return {
      userId: this.profile.id,
      deletedAt: this.withdrawnAt,
      deletedAddresses,
      // The account's sessions across every app. A constant rather than a
      // count of anything the double holds: sessions live in `session.ts` and
      // are per-app, and inventing an arithmetic relation between the two
      // stores would be a rule the real API does not have.
      revokedSessions: withdrawalDone.revokedSessions,
    }
  }

  /**
   * Everything answers 404 once the account is gone, including a second
   * withdrawal — "탈퇴 후 재호출도 404" (TASK-0111 4장 실패 계약).
   */
  private refuseWithdrawn(): void {
    if (this.withdrawnAt !== null) throw new MockApiError(404, '탈퇴한 계정입니다.')
  }

  private mustExist(id: string): Address {
    this.refuseWithdrawn()
    const row = this.rows.find((candidate) => candidate.id === id)

    if (row === undefined) throw new MockApiError(404, '배송지를 찾을 수 없습니다.')

    return row
  }

  private clearDefault(): void {
    this.rows = this.rows.map((row) => (row.isDefault ? { ...row, isDefault: false } : row))
  }

  private replace(address: Address): void {
    this.rows = this.rows.map((row) => (row.id === address.id ? address : row))
  }

  /** A v7 id on the seeds' own prefix, so a new row sorts after all of them. */
  private mintId(): string {
    const sequence = this.nextSequence
    this.nextSequence += 1

    return `${addressBook.items[0]?.id.slice(0, 24) ?? ''}${sequence.toString(16).padStart(12, '0')}`
  }
}

/** The tail of a seeded or minted id, as the number it encodes. */
function sequenceOf(id: string): number {
  return Number.parseInt(id.slice(24), 16)
}

/**
 * The fields a `PATCH` body actually carried.
 *
 * Spreading the parsed body directly would write `undefined` over a stored
 * value for every field the caller left out, which is the opposite of what a
 * partial update means.
 */
function definedOnly<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>
}

const store = new ProfileStore()

/** Set by {@link failNextDefaultAssignment}, cleared by the refusal it causes. */
let failNextDefault = false

/**
 * Puts the account back to the fixture. Called from `setupTestServer`'s
 * `afterEach`; a spec that wants a different starting point — an empty address
 * book, one row — passes it here in its own `beforeEach`, which runs after.
 */
export function resetProfileStore(seed?: readonly Address[]): void {
  store.reset(seed)
  failNextDefault = false
}

/**
 * Answers the next "make this the default" with the 409 the partial unique
 * index produces, once.
 *
 * **Why this exists rather than a staged race.** The invariant is enforced by
 * `Address_userId_default_key`, so the loser of two concurrent assignments
 * gets a `23505` that the API turns into a 409 instead of retrying — silently
 * overwriting the choice that won would be worse than saying the state moved
 * (TASK-0111 4장, F3b). msw runs in one process against one store, so the race
 * itself cannot happen here; what a screen has to get right is the *answer*,
 * and this hands it over.
 *
 * One-shot, like `failNextRefresh`: the recovery half — re-read the list, show
 * the default where it actually is — is the point, and a sticky failure would
 * make it untestable.
 */
export function failNextDefaultAssignment(): void {
  failNextDefault = true
}

/** The address book the double currently holds, ordered as it answers it. */
export function addressRowsSnapshot(): readonly Address[] {
  return store.snapshot()
}

/** The settings the double currently holds. Lets a spec assert a saved toggle. */
export function preferenceSnapshot(): UserPreference {
  return store.currentPreference()
}

/** The `:id` segment, as the uuid every `/me/addresses` route uses. */
function addressIdOf(params: PathParams): string {
  // `typeof` rather than `Array.isArray`: the guard widens a `readonly
  // string[]` to `any[]`, and reading `[0]` off that is an `any` the lint rules
  // refuse — rightly, since the id ends up in a URL.
  const raw: string | readonly string[] | undefined = params.id

  return (typeof raw === 'string' ? raw : raw?.[0]) ?? ''
}

export const profileHandlers: readonly RequestHandler[] = [
  http.get(mockPaths.me, () =>
    answering(() => HttpResponse.json(defineFixture(profileResponseSchema, store.readProfile()))),
  ),

  http.patch(mockPaths.me, ({ request }) =>
    answering(async () => {
      const body = await readBody(request, profileUpdateRequestSchema)

      return HttpResponse.json(defineFixture(profileResponseSchema, store.updateProfile(body)))
    }),
  ),

  http.delete(mockPaths.me, () =>
    answering(() => HttpResponse.json(defineFixture(withdrawalResponseSchema, store.withdraw()))),
  ),

  http.get(mockPaths.mePreferences, () =>
    answering(() =>
      HttpResponse.json(
        defineFixture(userPreferenceResponseSchema, { preference: store.currentPreference() }),
      ),
    ),
  ),

  http.patch(mockPaths.mePreferences, ({ request }) =>
    answering(async () => {
      const body = await readBody(request, userPreferenceUpdateRequestSchema)

      return HttpResponse.json(
        defineFixture(userPreferenceResponseSchema, { preference: store.updatePreference(body) }),
      )
    }),
  ),

  http.get(mockPaths.meAddresses, () =>
    answering(() =>
      HttpResponse.json(defineFixture(addressListResponseSchema, { items: [...store.list()] })),
    ),
  ),

  http.post(mockPaths.meAddresses, ({ request }) =>
    answering(async () => {
      const body = await readBody(request, addressCreateRequestSchema)

      return HttpResponse.json(
        defineFixture(addressResponseSchema, { address: store.create(body) }),
        {
          status: 201,
        },
      )
    }),
  ),

  /**
   * Registered before `mockPaths.meAddress`: msw takes the first handler that
   * matches, and although the two patterns differ in length today, keeping the
   * more specific one first is the rule `categoryReorder` already follows.
   */
  http.post(mockPaths.meAddressDefault, ({ params }) =>
    answering(() =>
      HttpResponse.json(
        defineFixture(addressResponseSchema, { address: store.makeDefault(addressIdOf(params)) }),
      ),
    ),
  ),

  http.patch(mockPaths.meAddress, ({ request, params }) =>
    answering(async () => {
      const body = await readBody(request, addressUpdateRequestSchema)

      return HttpResponse.json(
        defineFixture(addressResponseSchema, {
          address: store.update(addressIdOf(params), body),
        }),
      )
    }),
  ),

  http.delete(mockPaths.meAddress, ({ params }) =>
    answering(() =>
      HttpResponse.json(
        defineFixture(addressResponseSchema, { address: store.remove(addressIdOf(params)) }),
      ),
    ),
  ),
]
