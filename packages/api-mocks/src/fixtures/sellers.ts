import {
  brandNameAvailabilityResponseSchema,
  sellerSchema,
  storefrontSellerResponseSchema,
} from '@shopping/shared'

import { defineFixture } from '../define'
import { sessionSellerOwner } from './session'

/**
 * One store, at each of the four points its life can be at (TASK-0108 4장).
 *
 * **They are the same row, not four stores.** An account owns at most one
 * (`Seller_userId_key`), so `id`, `userId`, `slug` and `createdAt` are constant
 * across all four and only `status`, `statusReason` and `version` move. A set of
 * four unrelated rows would let a screen pass while reading a store that could
 * never exist — and the five faces TASK-0109 renders are five faces of *one*
 * store.
 *
 * The fifth state has no fixture, and cannot have one: "아직 신청하지 않았다" is
 * a **404** from `GET /sellers/me`, not a payload (`SellerService.ownStore`).
 * It is the mock store's default, so a spec gets it by saying nothing.
 *
 * **Ids come off `sessionSellerOwner` rather than being retyped.** The store has
 * to be the one the session's `own` scopes resolve against; two constants would
 * be two places to change and the drift would look like a permission bug.
 */

/** The store `sessionSellerOwner` owns. Fails this module's load if it is gone. */
const SELLER_ID = sessionSellerOwner.user.sellerId ?? ''

const OWNER_USER_ID = sessionSellerOwner.user.id

/**
 * Fixed instants, for the reason `fixtures/session.ts` gives: a fixture is
 * parsed once at module load and frozen, so a value computed from the clock
 * would be minutes old by the time a slow spec file read it.
 */
const CREATED_AT = '2026-08-30T02:11:07.000Z'
const DECIDED_AT = '2026-09-01T05:40:19.000Z'

/** Invented, like every brand in this repository (CLAUDE.md 6장). */
const BRAND_NAME = '루미에르'

const base = {
  id: SELLER_ID,
  userId: OWNER_USER_ID,
  brandName: BRAND_NAME,
  slug: 'lumiere',
  introduction: '동네 원단 시장에서 고른 천으로 한 벌씩 짓습니다.',
  logoUrl: 'https://cdn.test.invalid/sellers/lumiere/logo.png',
  statusReason: null,
  statusChangedAt: DECIDED_AT,
  createdAt: CREATED_AT,
} as const

/** Applied, waiting for a decision. Nobody has written a reason yet. */
export const sellerPending = defineFixture(sellerSchema, {
  ...base,
  status: 'PENDING',
  version: 0,
})

/**
 * Refused, with the sentence an operator wrote.
 *
 * `statusReason` is the whole point of this fixture: the seller has to be able
 * to read why and answer it, and a rejected store with a `null` reason would let
 * the screen's banner be untested for the case it exists for (F4).
 */
export const sellerRejected = defineFixture(sellerSchema, {
  ...base,
  status: 'REJECTED',
  statusReason: '로고 주소가 열리지 않습니다. 이미지 주소를 확인한 뒤 다시 신청해 주세요.',
  version: 1,
})

/** Approved and trading. `version` is past zero, so a save has to carry it. */
export const sellerActive = defineFixture(sellerSchema, {
  ...base,
  status: 'ACTIVE',
  version: 3,
})

/**
 * Trading stopped, orders already taken still to be fulfilled
 * (`state-machines.md` 6장).
 */
export const sellerSuspended = defineFixture(sellerSchema, {
  ...base,
  status: 'SUSPENDED',
  statusReason: '배송 지연 신고가 반복되어 판매를 잠시 멈췄습니다. 고객센터로 연락해 주세요.',
  version: 4,
})

/** `GET /sellers/brand-name-availability` when nobody holds the name. */
export const brandNameAvailable = defineFixture(brandNameAvailabilityResponseSchema, {
  value: BRAND_NAME,
  available: true,
})

/** The same endpoint when somebody does. A convenience, never the decision. */
export const brandNameTaken = defineFixture(brandNameAvailabilityResponseSchema, {
  value: '아틀리에오브',
  available: false,
})

/**
 * 상점이 보는 판매자 — 브랜드관의 머리 (TASK-0044 4.2).
 *
 * Built from the same `base`, so the brand page and the console cannot disagree
 * about the store's name. What it is missing is the point: no status, no reason,
 * no owning account, no lock. A visitor gets the shop window, not the file.
 */
export const storefrontSeller = defineFixture(storefrontSellerResponseSchema, {
  seller: {
    id: base.id,
    brandName: base.brandName,
    slug: base.slug,
    introduction: base.introduction,
    logoUrl: base.logoUrl,
  },
})
