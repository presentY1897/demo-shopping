import { z } from 'zod'

import { roleSchema } from '../auth/roles.js'

/**
 * The `/me` family: one's own profile, settings and address book (TASK-0111).
 *
 * Contract gate C1: these schemas are the only definition of a profile,
 * preference or address request in the repository. `apps/api` validates its
 * input with them and the front-ends parse their answers with them, so a
 * renamed field cannot be green on one side and broken on the other. C3 then
 * holds structurally, because `createApiClient` parses every response with the
 * very schema declared here.
 *
 * **Nothing here carries a user id.** Every endpoint these describe lives under
 * `/api/v1/me`, which names no account: there is no way to *ask* for somebody
 * else's profile, and the scope check in the service is the second line of
 * defence rather than the only one (TASK-0111 4장).
 */

/**
 * Product display density in `apps/shop`, mirroring the Prisma `DisplayDensity`
 * enum (`docs/design/pages.md` — 표시 밀도 3단계).
 *
 * Restated here rather than imported from the generated client for the reason
 * `roles` is: the three front-ends need the value and must not depend on the
 * API's database layer. `apps/api/src/profile/density-parity.spec.ts` fails if
 * the two lists ever diverge.
 */
export const displayDensities = ['MINIMAL', 'STANDARD', 'MAXIMAL'] as const

export type DisplayDensity = (typeof displayDensities)[number]

export const displayDensitySchema = z.enum(displayDensities)

/**
 * A Korean five-digit postal code.
 *
 * Pinned to a string, never a number: `06234` is not 6234, and a numeric column
 * would drop the leading zero of every code in Seoul's 0xxxx range. The server
 * does not normalise or look up the value — the address search widget is a
 * front-end concern (TASK-0112) — so this is the whole of the server's opinion.
 */
export const postalCodeSchema = z.string().regex(/^\d{5}$/)

/**
 * A Korean telephone number, with or without hyphens.
 *
 * Deliberately admits landlines as well as mobiles: the recipient of a parcel
 * is not always the buyer, and refusing `02-123-4567` would make a legitimate
 * address impossible to save. Stored exactly as typed, for the same reason the
 * postal code is — normalising here would mean the value a person reads back is
 * not the one they entered.
 */
export const phoneSchema = z.string().regex(/^0\d{1,2}-?\d{3,4}-?\d{4}$/)

export const addressLabelSchema = z.string().trim().min(1).max(20)
export const recipientNameSchema = z.string().trim().min(1).max(40)
export const addressLineSchema = z.string().trim().min(1).max(120)

/**
 * One saved address.
 *
 * **This is the seam M07's checkout reads** (TASK-0050): an order snapshots the
 * recipient rather than pointing at this row, so the shape has to be complete
 * enough to copy from. `label` is the only nullable field a person supplies —
 * "집", "회사" — and `addressLine2` is optional because a detached house has no
 * unit number.
 */
export const addressSchema = z.object({
  id: z.uuid(),
  label: z.string().nullable(),
  recipientName: z.string(),
  phone: z.string(),
  postalCode: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  /**
   * At most one per account, enforced by the partial unique index
   * `Address_userId_default_key` rather than by the service (`erd.md` 1장).
   */
  isDefault: z.boolean(),
})

export type Address = z.infer<typeof addressSchema>

/** What every single-address endpoint answers with. */
export const addressResponseSchema = z.object({ address: addressSchema })

export type AddressResponse = z.infer<typeof addressResponseSchema>

/**
 * The address book.
 *
 * Ordered by the API — default first, then newest — because "기본 배송지가 맨
 * 위" is a property of the answer and not of each screen that renders it. No
 * cursor: an address book is a handful of rows, and paging it would be a
 * contract nobody uses.
 */
export const addressListResponseSchema = z.object({ items: z.array(addressSchema) })

export type AddressListResponse = z.infer<typeof addressListResponseSchema>

/**
 * Adding an address.
 *
 * `isDefault` is a request, not a statement of fact: the first address an
 * account saves becomes the default whatever this says, because "there are
 * addresses but none of them is the default" is a state checkout would have to
 * carry a branch for (TASK-0111 4장).
 */
export const addressCreateRequestSchema = z.object({
  label: addressLabelSchema.nullable().optional(),
  recipientName: recipientNameSchema,
  phone: phoneSchema,
  postalCode: postalCodeSchema,
  addressLine1: addressLineSchema,
  addressLine2: addressLineSchema.nullable().optional(),
  isDefault: z.boolean().optional(),
})

export type AddressCreateRequest = z.infer<typeof addressCreateRequestSchema>

/**
 * Editing an address, field by field.
 *
 * **`isDefault` is absent on purpose.** Promotion is `POST
 * /me/addresses/:id/default`, which is a transaction that clears the previous
 * default first; allowing it here would give the same operation two doors, one
 * of which cannot hold the invariant.
 */
export const addressUpdateRequestSchema = z.object({
  label: addressLabelSchema.nullable().optional(),
  recipientName: recipientNameSchema.optional(),
  phone: phoneSchema.optional(),
  postalCode: postalCodeSchema.optional(),
  addressLine1: addressLineSchema.optional(),
  addressLine2: addressLineSchema.nullable().optional(),
})

export type AddressUpdateRequest = z.infer<typeof addressUpdateRequestSchema>

/**
 * Display and notification settings.
 *
 * `locale` and `currency` are here from the start even though only `ko-KR` and
 * `KRW` exist today: adding a locale later is then data rather than a migration
 * (DECISIONS 1 — 다국어는 구조만 선반영).
 */
export const userPreferenceSchema = z.object({
  density: displayDensitySchema,
  /** BCP 47 tag. */
  locale: z.string(),
  /** ISO 4217. Amounts are integer minor units; this says of what. */
  currency: z.string(),
  notifyOrder: z.boolean(),
  notifyClaim: z.boolean(),
  notifyMarketing: z.boolean(),
})

export type UserPreference = z.infer<typeof userPreferenceSchema>

/**
 * What an account with no `UserPreference` row is answered with.
 *
 * The row is created on first write, never on read: a `GET` that writes breaks
 * the moment it runs against a read replica or a narrowed database grant. So
 * the defaults have to be stated somewhere, and stating them here — rather than
 * in the API — is what lets a front-end render the settings screen for a person
 * who has never touched it without a round trip.
 *
 * These values **must** equal the column defaults in `schema.prisma`; the two
 * are compared against the real database in `test/api/me-preferences.spec.ts`
 * (F4b). Getting them apart would mean a setting silently changes the first
 * time it is saved.
 */
export const DEFAULT_USER_PREFERENCE: UserPreference = {
  density: 'STANDARD',
  locale: 'ko-KR',
  currency: 'KRW',
  notifyOrder: true,
  notifyClaim: true,
  notifyMarketing: false,
}

export const userPreferenceResponseSchema = z.object({ preference: userPreferenceSchema })

export type UserPreferenceResponse = z.infer<typeof userPreferenceResponseSchema>

/**
 * Changing settings, field by field.
 *
 * This is also the density promotion endpoint (TASK-0111 4장 — 밀도 승격): the
 * server does not distinguish "a signed-out visitor's stored choice is being
 * lifted onto the account" from "the person moved the toggle", because telling
 * them apart would mean trusting a flag the client sent. Whoever writes last
 * wins, and *when* to promote is TASK-0112's judgement.
 */
export const userPreferenceUpdateRequestSchema = z.object({
  density: displayDensitySchema.optional(),
  locale: z.string().min(2).max(35).optional(),
  currency: z.string().length(3).optional(),
  notifyOrder: z.boolean().optional(),
  notifyClaim: z.boolean().optional(),
  notifyMarketing: z.boolean().optional(),
})

export type UserPreferenceUpdateRequest = z.infer<typeof userPreferenceUpdateRequestSchema>

/**
 * One's own profile.
 *
 * `roles` travels with it so that a console can render what the account may do
 * without decoding the access token. `email` is read-only: the identity is
 * Google's `sub`, and letting somebody type an address would create a second,
 * unverified one (`schema.prisma`, `User.email`).
 *
 * **No demo flag, although TASK-0111 4장 listed one.** `apps/api/src/auth/
 * demo-containment.spec.ts` (TASK-0105 F8) allows the column to be named in
 * exactly three files, so that "데모냐" stays one value in the permission table
 * instead of a condition every service remembers to write. Putting it in a
 * response schema would name it in a fourth. The amendment procedure exists —
 * a task that genuinely needs the flag adds its file to that allow-list in the
 * same commit — but nothing in this task reads it: the demo banner belongs to
 * TASK-0024/0026 and the screens to TASK-0112, and the field would have shipped
 * with no reader at all.
 */
export const profileSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  roles: z.array(roleSchema),
})

export type Profile = z.infer<typeof profileSchema>

/**
 * `GET /me` and `PATCH /me`.
 *
 * Profile and settings together, because the page that shows one shows the
 * other and two round trips for one screen is a cost paid on every cold start
 * (DECISIONS 10 — Render 무료의 콜드 스타트).
 */
export const profileResponseSchema = z.object({
  profile: profileSchema,
  preference: userPreferenceSchema,
})

export type ProfileResponse = z.infer<typeof profileResponseSchema>

export const profileNameSchema = z.string().trim().min(1).max(40)

/**
 * Editing one's own profile.
 *
 * Name and avatar only. There is no contact number: `User` has no column for
 * one, and the value checkout actually uses is the recipient's on the address
 * — a second copy on the account would immediately disagree with it
 * (TASK-0111 R1).
 */
export const profileUpdateRequestSchema = z.object({
  name: profileNameSchema.optional(),
  avatarUrl: z.url().max(2048).nullable().optional(),
})

export type ProfileUpdateRequest = z.infer<typeof profileUpdateRequestSchema>

/**
 * What `DELETE /me` answers with.
 *
 * Counts rather than a bare 204, because withdrawal is the one action a person
 * cannot undo and the screen that confirms it should be able to say what
 * actually happened — how many addresses were erased, how many sessions were
 * ended. `deletedAt` is the account's own tombstone: the row survives so that
 * history keeps pointing at something (`erd.md` 1장).
 */
export const withdrawalResponseSchema = z.object({
  userId: z.uuid(),
  deletedAt: z.iso.datetime(),
  /** Addresses really removed — a hard delete, unlike the account itself. */
  deletedAddresses: z.int().min(0),
  /** Refresh tokens revoked, across every app. */
  revokedSessions: z.int().min(0),
})

export type WithdrawalResponse = z.infer<typeof withdrawalResponseSchema>
